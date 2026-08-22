const http = require("node:http");

const server = http.createServer((_request, response) => {
  response.writeHead(200, { "content-type": "text/html" });
  response.end("<main data-testid='proof'>Browser acceptance</main>");
});

server.listen(Number(process.env.PORT), "127.0.0.1");
for (const signal of ["SIGTERM", "SIGINT"]) {
  process.on(signal, () => server.close(() => process.exit(0)));
}
