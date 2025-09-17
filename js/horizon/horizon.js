import renderGradient from "./gradient.js";
import { getPosition } from "./suncalc/suncalc.js";
import { conf } from '../config.js';

export function refreshSky() {
  const now = new Date();
  const sunPos = getPosition(
    now,
    parseFloat(conf.location_latitude),
    parseFloat(conf.location_longitude),
  );
  
  const [gradient, topVec, bottomVec] = renderGradient(sunPos.altitude);
  
  const top = `rgb(${topVec[0]}, ${topVec[1]}, ${topVec[2]})`;
  const bottom = `rgb(${bottomVec[0]}, ${bottomVec[1]}, ${bottomVec[2]})`;
  
  document.body.style.background = gradient;
}