import dgram, { Socket as UdpSocket } from "dgram";
import { Socket as TcpSocket, AddressInfo } from "net";
import WgCtl, { parseData } from "wiegand-control";
import getLocalIp from "./utils/getLocalIp";
import env from "dotenv";

env.config();

const localIp = getLocalIp();
console.log(`[DMN] Local ip address is ${localIp}.`);

const localPort = +(process.env.LOCAL_PORT || 6000);
const remotePort = +(process.env.REMOTE_PORT || 8000);
const remoteHost = process.env.REMOTE_HOST;
const storeId = process.env.STORE_ID;

if (!remoteHost || !storeId) {
  throw new Error("invalid_config");
}

let controllerBySerial: { [serial: number]: WgCtl } = {};
let searchingControllerBySerial: { [serial: number]: WgCtl } = {};

const socket = dgram.createSocket("udp4"); // local network using udp
const client = new TcpSocket(); // remote network using tcp

socket.on("error", err => {
  console.log(`[UDP] Error:\n${err.stack}.`);
  socket.close();
});

socket.on("message", (msg, rinfo) => {
  const message = parseData(msg);
  console.log(
    `[UDP] Got message from ${rinfo.address}:${rinfo.port}.`,
    JSON.stringify(message)
  );
  if (message.funcName === "Search") {
    searchingControllerBySerial[message.serial] = new WgCtl(
      socket,
      message.serial,
      localIp,
      localPort,
      message.ip
    );
  } else {
    client.write(msg, err => {
      if (err) {
        console.error(err.message);
        return;
      }
    });
  }
});

socket.on("listening", async () => {
  const address = socket.address() as AddressInfo;
  console.log(`[UDP] Listening ${address.address}:${address.port}.`);
  await searchLocalControllers(socket);
  // setInterval(async () => {
  //   await searchLocalControllers(socket);
  // }, 10000);
  console.log(`[TCP] Connecting ${remoteHost}:${remotePort}...`);
  client.connect(remotePort, remoteHost);
});

socket.bind(localPort);

client.setTimeout(5000);

client.on("connect", () => {
  const address = client.remoteAddress;
  const port = client.remotePort;
  console.log(`[TCP] Connected to ${address}:${port}.`);
  client.setTimeout(360000);
  client.write(`store ${storeId}\r\n`);
  // TODO send local ip to remote server
});

client.on("timeout", () => {
  console.log("[TCP] Connection timeout.");
  client.destroy(new Error("timeout"));
});

client.on("close", () => {
  console.log(`[TCP] Closed, reconnect in 10 seconds.`);
  setTimeout(() => {
    client.connect(remotePort, remoteHost);
  }, 10000);
});

client.on("error", err => {
  console.error(`[TCP] Error: ${err.message}.`);
});

client.on("data", async data => {
  // console.log(`[TCP] got remote data\n`, data);
  if (data.length !== 64) {
    console.log("[TCP] Data:", data.toString());
    return;
  }
  const parsedData = parseData(data);
  const serial = parsedData.serial;

  let controller: WgCtl;

  if (!serial) {
    controller = new WgCtl(socket);
  } else if (controllerBySerial[serial]) {
    controller = controllerBySerial[serial];
  } else {
    console.error(`[DMN] Controller ${serial} not found, trying re-search.`);
    new WgCtl(socket).search();
    return;
  }

  controller.sendData(
    data.readUInt8(1),
    Buffer.from(
      data
        .slice(8)
        .toString("hex")
        .replace(/(00)*$/, ""),
      "hex"
    )
  );
});

async function searchLocalControllers(socket: UdpSocket) {
  socket.setBroadcast(true);
  searchingControllerBySerial = {};
  new WgCtl(socket).search();
  return new Promise(resolve => {
    setTimeout(() => {
      const searchingSerials = Object.keys(searchingControllerBySerial);
      const serials = Object.keys(controllerBySerial);
      if (
        searchingSerials.length === serials.length &&
        searchingSerials.every(serial => serials.includes(serial))
      ) {
        return;
      }
      console.log(
        `[UDP] Search timeout, controller changed:`,
        Object.keys(searchingControllerBySerial).join(",")
      );
      controllerBySerial = searchingControllerBySerial;
      socket.setBroadcast(false);
      resolve();
    }, 2000);
  });
}

// setTimeout(async () => {
//   const controllers = serials.map(serial => new WgCtl(socket, serial));
//   await Promise.all(controllers.map(ctl => ctl.detected));
//   controllers.map(c => c.getServerAddress());
// }, 1000);
