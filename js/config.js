import { easing } from './easing.js'
export var conf = {
  steps: 15,
  easing: get_element("easing", 'easeInOutBack'),
  twentyFourHourClock: JSON.parse(get_element("twentyFourHourClock", true)),
  hideSeconds: JSON.parse(get_element("hideSeconds", false)),
  preciseLocation: JSON.parse(get_element("preciseLocation", false)),
  gpsFrequency: JSON.parse(get_element("gpsFrequency", "-1")),
  compassDirection: JSON.parse(get_element("compassDirection", false)),
  location: JSON.parse(get_element("location", JSON.stringify({
  latitude: -1,
  longitude: -1,
  accuracy: -1,
  heading: -1,
  altitude: -1,
  altitudeAccuracy: -1,
  screenAngle: -1
})))
};

export var vars = {
  inited: false,
  t: ["h", "m", "s"],
  step: 1000 / conf.steps
};

export var dd = [];
dd[0] = [254, 47, 159, 84, 123, 158, 131, 258, 139, 358, 167, 445, 256, 446, 345, 447, 369, 349, 369, 275, 369, 201, 365, 81, 231, 75];
dd[1] = [138, 180, 226, 99, 230, 58, 243, 43, 256, 28, 252, 100, 253, 167, 254, 234, 254, 194, 255, 303, 256, 412, 254, 361, 255, 424];
dd[2] = [104, 111, 152, 55, 208, 26, 271, 50, 334, 74, 360, 159, 336, 241, 312, 323, 136, 454, 120, 405, 104, 356, 327, 393, 373, 414];
dd[3] = [96, 132, 113, 14, 267, 17, 311, 107, 355, 197, 190, 285, 182, 250, 174, 215, 396, 273, 338, 388, 280, 503, 110, 445, 93, 391];
dd[4] = [374, 244, 249, 230, 192, 234, 131, 239, 70, 244, 142, 138, 192, 84, 242, 30, 283, -30, 260, 108, 237, 246, 246, 435, 247, 438];
dd[5] = [340, 52, 226, 42, 153, 44, 144, 61, 135, 78, 145, 203, 152, 223, 159, 243, 351, 165, 361, 302, 371, 439, 262, 452, 147, 409];
dd[6] = [301, 26, 191, 104, 160, 224, 149, 296, 138, 368, 163, 451, 242, 458, 321, 465, 367, 402, 348, 321, 329, 240, 220, 243, 168, 285];
dd[7] = [108, 52, 168, 34, 245, 42, 312, 38, 379, 34, 305, 145, 294, 166, 283, 187, 243, 267, 231, 295, 219, 323, 200, 388, 198, 452];
dd[8] = [243, 242, 336, 184, 353, 52, 240, 43, 127, 34, 143, 215, 225, 247, 307, 279, 403, 427, 248, 432, 93, 437, 124, 304, 217, 255];
dd[9] = [322, 105, 323, 6, 171, 33, 151, 85, 131, 137, 161, 184, 219, 190, 277, 196, 346, 149, 322, 122, 298, 95, 297, 365, 297, 448];

function get_element(element_name, default_value = "") {
  let temp = localStorage.getItem(element_name);
  if (temp === null)
  {
    temp = default_value;
  }
  return temp;
}

function set_element(element_name, set_value) {
  localStorage.setItem(element_name, set_value);
}

export function adjustTimeSize() {
  if (conf.hideSeconds) {
    document.querySelector("#firstSeperator").style.marginRight = "-25%";
    document.querySelectorAll('.seconds').forEach(element => {
      element.style.display = 'none';
    });
  } else {
    document.querySelectorAll('.seconds').forEach(element => {
      element.style.display = '';
    });
    document.querySelector("#firstSeperator").style.marginRight = (conf.hideSeconds ? "-25%" : "-15%");
  }
}

export function set_conf(element, value) {
  conf[element] = value;
  set_element(element, value);
  console.info("conf." + element + " = " + value);
  
  if (element == "hideSeconds") {
    adjustTimeSize();
  }
}