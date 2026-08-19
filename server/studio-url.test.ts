import { expect, test } from "bun:test";

import { replaceOrigin } from "./studio-service";

test("replaceOrigin removes an internal port from a portless public origin", () => {
  expect(replaceOrigin(
    "http://web.railway.internal:8080/demo-shop.html",
    "http://web.railway.internal:8080",
    "https://flakey.example.test",
  )).toBe("https://flakey.example.test/demo-shop.html");
});

test("replaceOrigin preserves an explicit target port", () => {
  expect(replaceOrigin(
    "https://flakey.example.test/path?step=1",
    "https://flakey.example.test",
    "http://web:8080",
  )).toBe("http://web:8080/path?step=1");
});
