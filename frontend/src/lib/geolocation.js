// Promise wrapper over the browser Geolocation API. On denial/timeout we resolve
// with nulls rather than reject -- a driver with no GPS fix (poor signal, denied
// permission) must still be able to submit a check-in; the missing coordinates are
// simply visible to admins on that event.
export function getPosition({ timeout = 10000 } = {}) {
  return new Promise((resolve) => {
    if (!("geolocation" in navigator)) {
      resolve({ lat: null, lng: null, error: "geolocation not supported" });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude, error: null }),
      (err) => resolve({ lat: null, lng: null, error: err.message }),
      { enableHighAccuracy: true, timeout, maximumAge: 0 }
    );
  });
}
