import { RAD } from '@jarvis/components/toolkit/wave6/model';
export const EARTH = 6371.0088;
export const wrap = degrees => ((degrees+180)%360+360)%360-180;
export const heading = radians => ((radians/RAD)%360+360)%360;
export function separation(lat1,lon1,lat2,lon2) {
  const a=Math.sin((lat2-lat1)*RAD/2)**2+Math.cos(lat1*RAD)*Math.cos(lat2*RAD)*Math.sin((lon2-lon1)*RAD/2)**2;
  return 2*Math.atan2(Math.sqrt(Math.max(0,Math.min(1,a))),Math.sqrt(Math.max(0,1-a)));
}
export function bearing(lat1,lon1,lat2,lon2) {
  const a=lat1*RAD,b=lat2*RAD,d=(lon2-lon1)*RAD;
  return Math.atan2(Math.sin(d)*Math.cos(b),Math.cos(a)*Math.sin(b)-Math.sin(a)*Math.cos(b)*Math.cos(d));
}
export const ambiguous = p => {const d=separation(p.aLat,p.aLon,p.bLat,p.bLon);return d<1e-10||Math.abs(Math.PI-d)<1e-10?'Choose distinct, non-antipodal route endpoints.':null;};