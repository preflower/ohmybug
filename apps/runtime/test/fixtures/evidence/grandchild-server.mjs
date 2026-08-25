import { createServer } from "node:http";
import process from "node:process";

createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/plain" });
  response.end("ready");
}).listen(Number(process.env.PORT), "127.0.0.1");
