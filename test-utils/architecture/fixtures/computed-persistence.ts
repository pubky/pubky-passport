export const computedPersistence = {
  localStorage: globalThis["localStorage"],
  sessionStorage: window[`sessionStorage`],
  cookie: document["cookie"],
};
