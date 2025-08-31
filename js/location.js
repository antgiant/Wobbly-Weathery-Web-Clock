import Virgo from './virgo/virgo.js';
import { conf } from './config.js';

let locationRefresh;

function refreshLocation() {
  if (conf.preciseLocation && ('geolocation' in navigator)) {
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        conf.location_latitude = latitude;
        conf.location_longitude = longitude;
        conf.location_accuracy = accuracy;
        conf.location_altitude = altitude;
        conf.location_altitudeAccuracy = altitudeAccuracy;
        conf.location_heading = heading;
      },
      (err) => console.log(`GPS error: ${err.message}`),
      {
        enableHighAccuracy: true, // try GPS when available
        timeout: 10000,
        maximumAge: 0
      }
    )
  } else {
    let temp = Virgo.getLocation();
    conf.location_latitude = temp.latitude;
    conf.location_longitude = temp.longitude;
  }
  clearInterval(locationRefresh);
  if (conf.gpsFrequency > 0) {
    locationRefresh = setInterval(refreshLocation, conf.gpsFrequency * 60000);
  }
}

function initalize() {
  //Set up config option actions
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('gpsFrequency').addEventListener('change', (event) => {
      conf.gpsFrequency = event.target.options[event.target.selectedIndex].value;
      refreshLocation();
    });
  });
  
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('preciseLocation').addEventListener('change', (event) => {
      conf.preciseLocation = event.target.checked;
      refreshLocation();
    });
  });
  
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('compassDirection').addEventListener('change', (event) => {
      conf.compassDirection = event.target.checked;
      refreshLocation();
    });
  });
  
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('refreshLocation').addEventListener('click', (event) => {
      refreshLocation();
    });
  });
  
  
  //Set up initial config settings state
  document.getElementById("preciseLocation").checked = conf.preciseLocation;
  
  document.getElementById("compassDirection").checked = conf.compassDirection;
  
  document.getElementById('gpsFrequency').value = conf.gpsFrequency;
  
  //Remove precise location option if it isn't supported
  if (!('geolocation' in navigator)) {
    console.log('Geolocation not supported.');
    conf.preciseLocation = false;
    document.getElementById("preciseLocation").style.display = 'none';
  }
  
  refreshLocation();
}

initalize();