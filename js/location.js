import Virgo from './virgo/virgo.js';
import { conf } from './config.js';
import { validZone } from './timezone.js';
import { findCities } from './cities.js';
const notifyLocation = () => window.dispatchEvent(new Event('locationchange'));

let locationRefresh;

const esc = (t) => String(t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function coordsHtml() {
  const la = Number(conf.location_latitude).toFixed(3), lo = Number(conf.location_longitude).toFixed(3);
  const name = conf.manualLocation && conf.location_name ? esc(conf.location_name) + ' ' : '';
  return (conf.manualLocation ? 'Place (set by you): ' : 'Current Location: ') + name + "<a href='https://www.google.com/maps/place/" + la + "," + lo + "' target='_blank' rel='noopener'>(" + la + ", " + lo + ")</a>";
}

/** A latitude or longitude typed by a person: a number within range, or null. */
export function parseCoord(text, limit) {
  const n = Number(String(text).trim().replace(',', '.'));
  return String(text).trim() !== '' && Number.isFinite(n) && Math.abs(n) <= limit ? n : null;
}

function refreshLocation() {
  if (conf.manualLocation) {                                   // the place was set by hand: nothing replaces it
    clearInterval(locationRefresh);
    const c = document.getElementById('coords'); if (c) c.innerHTML = coordsHtml();
    notifyLocation();
    return;
  }
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
  if (conf.manualLocation) { conf.locationChoice = 'manual'; return; }          // a place that was set by hand: never asked
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

// ---- "Set the place myself": coordinates, or a search by name (the free Open-Meteo geocoding service, only when asked) ----
function initManual() {
  const $ = (id) => document.getElementById(id);
  const box = $('manualLocation'), fields = $('manualFields'), lat = $('manualLat'), lon = $('manualLon'), hint = $('manualHint'), search = $('placeSearch'), list = $('placeResults');
  if (!box || !fields) return;
  const show = () => {
    fields.hidden = !conf.manualLocation;
    box.checked = !!conf.manualLocation;
    for (const id of ['preciseLocation', 'gpsFrequency', 'refreshLocation']) { const e = $(id); if (e) e.disabled = !!conf.manualLocation; }
    if (conf.manualLocation) { lat.value = Number(conf.location_latitude).toFixed(4); lon.value = Number(conf.location_longitude).toFixed(4); }
    const c = $('coords'); if (c) c.innerHTML = coordsHtml();
  };
  const apply = (la, lo, name) => {
    conf.location_latitude = la; conf.location_longitude = lo; conf.location_name = name || '';
    conf.manualLocation = true; conf.locationChoice = 'manual';
    show(); notifyLocation();
  };
  box.addEventListener('change', () => {
    conf.manualLocation = box.checked;
    if (box.checked) conf.locationChoice = 'manual';
    else { conf.location_name = ''; conf.locationChoice = conf.preciseLocation ? 'real' : 'estimated'; refreshLocation(); }
    hint.textContent = '';
    show(); if (box.checked) notifyLocation();
  });
  const fromBoxes = () => {
    const la = parseCoord(lat.value, 90), lo = parseCoord(lon.value, 180);
    lat.setAttribute('aria-invalid', String(la === null)); lon.setAttribute('aria-invalid', String(lo === null));
    if (la === null || lo === null) { hint.textContent = la === null ? 'The latitude must be a number from -90 (south) to 90 (north).' : 'The longitude must be a number from -180 (west) to 180 (east).'; return; }
    hint.textContent = '';
    apply(Math.round(la * 1e4) / 1e4, Math.round(lo * 1e4) / 1e4, '');
  };
  lat.addEventListener('change', fromBoxes); lon.addEventListener('change', fromBoxes);
  let timer = 0, seq = 0;
  search.addEventListener('input', () => {
    clearTimeout(timer);
    const q = search.value.trim();
    if (q.length < 2) { list.hidden = true; list.textContent = ''; return; }
    timer = setTimeout(async () => {
      const mine = ++seq;
      const listPlaces = (found, note) => {
        list.textContent = '';
        for (const x of found) {
          const li = document.createElement('li'), b = document.createElement('button');
          b.type = 'button'; b.textContent = [x.name, x.admin1, x.country].filter(Boolean).join(', ');
          b.addEventListener('click', () => { apply(Math.round(x.latitude * 1e4) / 1e4, Math.round(x.longitude * 1e4) / 1e4, [x.name, x.country].filter(Boolean).join(', ')); if (x.timezone && validZone(x.timezone)) { conf.timeZone = x.timezone; showZone(); } search.value = ''; list.hidden = true; hint.textContent = ''; });
          li.appendChild(b); list.appendChild(li);
        }
        list.hidden = !found.length;
        hint.textContent = note;
      };
      // with no connection (or no answer) the short list of large cities built into the page is used instead
      const offline = (why) => {
        const local = findCities(q).map((c) => ({ name: c[0], country: c[1], latitude: c[2], longitude: c[3], timezone: c[4] }));
        listPlaces(local, local.length ? `${why} Showing large cities from the list built into the page.` : `${why} Only large cities are known without a connection: type the coordinates instead.`);
      };
      if (navigator.onLine === false) { offline('No connection.'); return; }
      try {
        const r = await fetch('https://geocoding-api.open-meteo.com/v1/search?count=6&language=en&format=json&name=' + encodeURIComponent(q));
        const j = await r.json();
        if (mine !== seq) return;
        const found = (j.results || []).filter((x) => Number.isFinite(x.latitude) && Number.isFinite(x.longitude));
        listPlaces(found, found.length ? '' : 'No place found: try another spelling, or type the coordinates.');
      } catch (_) { if (mine === seq) offline('Could not reach the search service.'); }
    }, 400);
  });
  show();
}

// ---- "Show the time in another time zone": an IANA name typed or filled in by a place search ----
function showZone() {
  const box = document.getElementById('timeZone');
  if (!box) return;
  box.value = conf.timeZone || '';
  box.setAttribute('aria-invalid', String(!!box.value && !validZone(box.value)));
}
function initZone() {
  const box = document.getElementById('timeZone'), hint = document.getElementById('timeZoneHint'), list = document.getElementById('timeZoneList');
  if (!box) return;
  try { if (list && Intl.supportedValuesOf) for (const z of Intl.supportedValuesOf('timeZone')) { const o = document.createElement('option'); o.value = z; list.appendChild(o); } } catch (_) { /* a browser without the list: typing still works */ }
  const plain = hint.textContent;
  box.addEventListener('change', () => {
    const v = box.value.trim();
    if (v === '' || validZone(v)) { conf.timeZone = v; hint.textContent = v ? `Showing the time in ${v.replace(/_/g, ' ')}.` : plain; }
    else hint.textContent = 'That is not a time zone name this browser knows. Names look like America/New_York or Europe/Paris.';
    showZone();
    window.dispatchEvent(new Event('timezonechange'));
  });
  showZone();
}
document.addEventListener('DOMContentLoaded', () => { initManual(); initZone(); });

initalize();