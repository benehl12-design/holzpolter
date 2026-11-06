#!/usr/bin/env python3
"""Probe the government P95 ZIP feed; do not download raster archives."""
import urllib.request,xml.etree.ElementTree as ET,re
from urllib.parse import urljoin
feed="https://geodpags.skogsstyrelsen.se/geodataport/feeds/SGDP95_omdrev2.xml"
r=urllib.request.urlopen(urllib.request.Request(feed,headers={"User-Agent":"Lignum-Forestry-Data/1.0"}),timeout=35)
data=r.read(2_000_000)
print("FEED STATUS",r.status,"BYTES",len(data),flush=True)
print("HEAD",data[:400],flush=True)
root=ET.fromstring(data)
links=[]
for e in root.iter():
 for prop in ("href","url"):
  u=e.attrib.get(prop)
  if u and ".zip" in u.lower(): links.append(urljoin(feed,u))
 if e.text and ".zip" in e.text.lower():
  links+=re.findall(r"https?[^\s<>\"']+\.zip",e.text)
print("ZIP LINKS",len(links),flush=True)
for u in dict.fromkeys(links):
 if re.search(r"(?:_25|Norrbotten)\b",u,re.I):
  try:
   v=urllib.request.urlopen(urllib.request.Request(u,method="HEAD"),timeout=25)
   print("NORRBOTTEN",u,"SIZE",v.headers.get("Content-Length"),"TYPE",v.headers.get("Content-Type"),flush=True)
  except Exception as exc:
   print("HEAD failed",u,str(exc),flush=True)
