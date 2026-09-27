import app from "./routes";

export default {
  hostname: process.env.HOST ?? "127.0.0.1",
  port: Number(process.env.PORT ?? 8787),
  fetch: app.fetch,
};
