import {
  proxyAddress,
  proxyPort,
  proxyUsername,
  proxyPassword,
} from "profile.json";

const proxy = {
  protocol: "http",
  host: proxyAddress,
  port: proxyPort,
  auth: {
    username: proxyUsername,
    password: proxyPassword,
  },
};

export { proxy };