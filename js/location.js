import Virgo from './virgo/virgo.js';
import { conf } from './config.js';
const notifyLocation = () => window.dispatchEvent(new Event('locationchange'));

let locationRefresh;

function coordsHtml() {
  const la = Number(conf.location_latitude).toFixed(3), lo = Number(conf.location_longitude).toFixed(3);
  return "Current Location: <a href='https://www.google.com/maps/place/" + la + "," + lo + "' target='_blank' rel='noopener'>(" + la + ", " + lo + ")</a>";
}

function refreshLocation() {
  if (conf.gpsFrequency >= -1) {
    if (conf.preciseLocation && ('geolocation' in navigator)) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          conf.location_latitude = pos.coords.latitude;
          conf.location_longitude = pos.coords.longitude;
          conf.location_accuracy = pos.coords.accuracy;
          conf.location_altitude = pos.coords.altitude;
          conf.location_altitudeAccuracy = pos.coords.altitudeAccuracy;
          document.getElementById('coords').innerHTML = coordsHtml();
          notifyLocation();
        },
        (err) => {
          console.info(`GPS error: ${err.message}`);
          if (err.code == err.PERMISSION_DENIED) {
            //fallback to general location
            let temp = Virgo.getLocation();
            conf.location_latitude = temp.latitude;
            conf.location_longitude = temp.longitude;
            
            //turn off precise
            conf.preciseLocation = false;
            conf.locationChoice = 'estimated';
            document.getElementById("preciseLocation").checked = conf.preciseLocation;
            notifyLocation();
          }
        },
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
  } else {
    conf.location_latitude = Math.min(90, Math.max(-90, parseFloat(prompt("Please enter your latitude", conf.location_latitude)))) || 0;
    conf.location_longitude = Math.min(180, Math.max(-180, parseFloat(prompt("Please enter your longitude", conf.location_longitude)))) || 0;
  }
  clearInterval(locationRefresh);
  if (conf.gpsFrequency > 0) {
    locationRefresh = setInterval(refreshLocation, conf.gpsFrequency * 60000);
  }
  document.getElementById('coords').innerHTML = coordsHtml();
  
  notifyLocation();
}

function initalize() {
  // has this browser been here before? (must be read before the first refreshLocation() saves a location)
  const returning = Number(conf.location_latitude) !== -1 || Number(conf.location_longitude) !== -1;
  //Set up config option actions
  document.addEventListener('DOMContentLoaded', () => {
    document.getElementById('gpsFrequency').addEventListener('change', (event) => {
      conf.gpsFrequency = event.target.options[event.target.selectedIndex].value;
      if (conf.gpsFrequency >= -1) {
        document.getElementById('refreshLocation').textContent = "Refresh Location";
      } else {
        document.getElementById('refreshLocation').textContent = "Edit Location";
      }
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
    document.getElementById('refreshLocation').addEventListener('click', (event) => {
      refreshLocation();
    });
  });
  
  
  //Set up initial config settings state
  document.getElementById("preciseLocation").checked = conf.preciseLocation;
  
  document.getElementById('gpsFrequency').value = conf.gpsFrequency;
  
  if (conf.gpsFrequency >= -1) {
    document.getElementById('refreshLocation').textContent = "Refresh Location";
  } else {
    document.getElementById('refreshLocation').textContent = "Edit Location";
  }
  
  //Remove precise location option if it isn't supported
  if (!('geolocation' in navigator)) {
    console.info("Geolocation not supported.");
    conf.preciseLocation = false;
    (document.getElementById("preciseLocation").closest('.field') || document.getElementById("preciseLocation")).style.display = 'none';
  }
  
  refreshLocation();
  askLocationOnce(returning);
}

// First visit: one question. Anyone who has been here before (they have a saved location) is not asked.
function askLocationOnce(known) {
  const q = new URLSearchParams(location.search);
  if (conf.locationChoice == null && (known || q.has('lat'))) { conf.locationChoice = conf.preciseLocation ? 'real' : 'estimated'; return; }
  if (conf.locationChoice != null) return;
  if (!('geolocation' in navigator)) { conf.locationChoice = 'estimated'; return; }
  // the sky is already drawn from the time-zone estimate behind the card, so there is something to look at while deciding
  const box = document.getElementById('welcome');
  if (!box) return;
  const done = (real) => {
    box.hidden = true;
    conf.locationChoice = real ? 'real' : 'estimated';
    if (real) {
      conf.preciseLocation = true;
      document.getElementById('preciseLocation').checked = true;
      refreshLocation();                       // this is the click that lets the browser show its permission prompt
    }
  };
  document.getElementById('welcomeReal').addEventListener('click', () => done(true));
  document.getElementById('welcomeEstimate').addEventListener('click', () => done(false));
  box.hidden = false;
  document.getElementById('welcomeReal').focus();
}

initalize();