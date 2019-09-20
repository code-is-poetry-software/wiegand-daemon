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
const remoteHost = process.env.REMOTE_HOST || "api.kangazone.com";

const controllerBySerial: { [serial: number]: WgCtl } = {};

const socket = dgram.createSocket("udp4"); // local network using udp
const client = new TcpSocket(); // remote network using tcp

socket.on("error", err => {
  console.log(`[DMN] Socket error:\n${err.stack}.`);
  socket.close();
});

socket.on("message", (msg, rinfo) => {
  const message = parseData(msg);
  console.log(
    `[DMN] Socket got local message from ${rinfo.address}:${rinfo.port}. \n`,
    message
  );
  if (message.funcName === "Search") {
    controllerBySerial[message.serial] = new WgCtl(
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
  console.log(`[DMN] Socket listening ${address.address}:${address.port}.`);
  await searchLocalControllers(socket);
  client.connect(remotePort, remoteHost);
});

socket.bind(localPort);

client.on("connect", () => {
  const address = client.remoteAddress;
  const port = client.remotePort;
  console.log(`[DMN] Socket connected to ${address}:${port}.`);
  // TODO send local ip to remote server
});

client.on("close", () => {
  console.log(`[DMN] Socket closed. Reconnect after 10 seconds.`);
  setTimeout(() => {
    client.connect(remotePort, remoteHost);
  }, 10000);
});

client.on("error", err => {
  console.error(`[DMN] Socket error: ${err.message}.`);
});

client.on("data", async data => {
  // console.log(`[DMN] Socket got remote data\n`, data);
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
  new WgCtl(socket).search();
  return new Promise(resolve => {
    setTimeout(() => {
      console.log(
        `[DMN] Search timeout, controller found:`,
        Object.keys(controllerBySerial)
      );
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
