import { it } from "vitest";

it("sends a request and leaves it to the network", () => {
  const request = new XMLHttpRequest();
  request.open("GET", "/api/left-to-the-network");
  request.send();
});
