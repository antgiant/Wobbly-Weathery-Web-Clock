import renderGradient from "./gradient.js";
import { getPosition } from "./suncalc/suncalc.js";
import { conf } from '../config.js';

function setFaviconFromGradient(top, bottom) {
  const canvas = document.createElement("canvas");
  canvas.width = 64;
  canvas.height = 64;
  const ctx = canvas.getContext("2d");

  const grad = ctx.createLinearGradient(0, 0, 0, 64);
  grad.addColorStop(0, top);
  grad.addColorStop(1, bottom);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, 64, 64);

  // Update favicon
  // Remove old favicons
  const links = document.querySelectorAll("link[rel~='icon']");
  links.forEach(link => link.parentNode.removeChild(link));

  //add new favicon
  const link = document.querySelector("link[rel~='icon']") || document.createElement("link");
  link.rel = "icon";
  link.href = canvas.toDataURL("image/png");
  document.head.appendChild(link);
}

export function refreshSky() {
  const now = new Date();
  const sunPos = getPosition(
    now,
    parseFloat(conf.location_latitude),
    parseFloat(conf.location_longitude),
  );
  
  const [gradient, topVec, bottomVec] = renderGradient(sunPos.altitude, conf.location_heading);
  
  const top = `rgb(${topVec[0]}, ${topVec[1]}, ${topVec[2]})`;
  const bottom = `rgb(${bottomVec[0]}, ${bottomVec[1]}, ${bottomVec[2]})`;
  
  document.body.style.background = gradient;
  setFaviconFromGradient(top, bottom);
}