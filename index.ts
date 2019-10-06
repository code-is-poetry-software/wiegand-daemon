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
const searchTimeout = +(process.env.SEARCH_TIMEOUT || 3000);
const searchInterval = +(process.env.SEARCH_INTERVAL || 300000);

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
  console.log(`[TCP] Connecting ${remoteHost}:${remotePort}...`);
  client.connect(remotePort, remoteHost);
  client.setTimeout(1000);
});

socket.bind(localPort);

client.on("connect", async () => {
  const address = client.remoteAddress;
  const port = client.remotePort;
  console.log(`[TCP] Connected to ${address}:${port}.`);
  client.setTimeout(360000);
  await searchAndReportLocalControllers(socket, client);
  setInterval(async () => {
    await searchAndReportLocalControllers(socket, client);
  }, searchInterval);
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

async function searchAndReportLocalControllers(
  socket: UdpSocket,
  client: TcpSocket
) {
  socket.setBroadcast(true);
  searchingControllerBySerial = {};
  new WgCtl(socket).search();
  await new Promise(resolve => {
    setTimeout(async () => {
      resolve();
    }, searchTimeout);
  });
  socket.setBroadcast(false);
  const searchingSerials = Object.keys(searchingControllerBySerial);
  const serials = Object.keys(controllerBySerial);
  if (
    !(
      searchingSerials.length === serials.length &&
      searchingSerials.every(serial => serials.includes(serial))
    )
  ) {
    console.log(
      `[UDP] Search timeout, controller changed:`,
      Object.keys(searchingControllerBySerial).join(",")
    );
  }

  console.log(
    `[TCP] Reporting searched controllers: ${Object.keys(
      searchingControllerBySerial
    ).join(",")}`
  );
  client.write(
    `store ${JSON.stringify({
      storeId,
      serials: Object.keys(searchingControllerBySerial).map(s => +s)
    })}\r\n`
  );

  controllerBySerial = searchingControllerBySerial;
  if (searchingSerials.length < serials.length) {
    console.warn(
      `[DMN] Some controller is lost, controllers left: ${Object.keys(
        controllerBySerial
      ).join(",")}`
    );
  }
}
