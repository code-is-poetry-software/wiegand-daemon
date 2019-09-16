import dgram from "dgram";
import { Socket, AddressInfo } from "net";
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
const client = new Socket(); // remote network using tcp

socket.on("error", err => {
  console.log(`[DMN] Socket error:\n${err.stack}.`);
  socket.close();
});

socket.on("message", (msg, rinfo) => {
  console.log(
    `[DMN] Socket got local message from ${rinfo.address}:${rinfo.port}. \n`,
    parseData(msg)
  );
  client.write(msg, err => {
    if (err) {
      console.error(err.message);
      return;
    }
  });
});

socket.on("listening", () => {
  const address = socket.address() as AddressInfo;
  console.log(`[DMN] Socket listening ${address.address}:${address.port}.`);
});

socket.bind(localPort);

client.connect(remotePort, remoteHost);

client.on("connect", () => {
  const address = client.remoteAddress;
  const port = client.remotePort;
  console.log(`[DMN] Socket connected to ${address}:${port}.`);
});

client.on("close", () => {
  console.log(`[DMN] Socket closed. Reconnect after 1 second.`);
  setTimeout(() => {
    client.connect(remotePort, remoteHost);
  }, 1000);
});

client.on("error", err => {
  console.error(`[DMN] Socket error: ${err.message}.`);
});

client.on("data", async data => {
  console.log(`[DMN] Socket got remote data\n`, data);
  const parsedData = parseData(data);
  const serial = parsedData.serial;
  // if (!serial) {
  //   client.destroy(new Error("No controller serial could be parsed."));
  // }
  let controller = controllerBySerial[serial];
  if (!controller) {
    controller = new WgCtl(socket, parsedData.serial, localIp, localPort);
    await controller.detected;
    controllerBySerial[serial] = controller;
  }
  controller.sendData(data.readUInt8(1), data.slice(8));
});

// setTimeout(async () => {
//   const controllers = serials.map(serial => new WgCtl(socket, serial));
//   await Promise.all(controllers.map(ctl => ctl.detected));
//   controllers.map(c => c.getServerAddress());
// }, 1000);
