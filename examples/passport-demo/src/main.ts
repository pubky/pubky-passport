import "./style.css";
import { start } from "./app";

const app = document.querySelector<HTMLDivElement>("#app");
if (!app) throw new Error("Missing #app element");

start(app);
