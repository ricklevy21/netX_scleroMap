const fs = require("fs/promises");

const NETX_BASE_URL = process.env.NETX_BASE_URL;
const NETX_TOKEN = process.env.NETX_TOKEN;
const FOLDER_ID = 2519;

const rpcUrl = `${NETX_BASE_URL.replace(/\/$/, "")}/api/rpc`;

async function rpcCall(method, params) {
  const res = await fetch(rpcUrl, {
    method: "POST",
    headers: {
      Authorization: `apiToken ${NETX_TOKEN}`,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ jsonrpc: "2.0", id: Date.now(), method, params })
  });
  const json = await res.json();
  if (json.error) {
    console.error("RPC error:", JSON.stringify(json.error, null, 2));
    process.exit(1);
  }
  return json.result;
}

function parseDMS(val) {
  if (!val) return null;
  val = String(val).trim();
  const dir = val.slice(-1).toUpperCase();
  const parts = val.slice(0, -1).split(",");
  if (parts.length < 2) return null;
  const deg = parseFloat(parts[0]);
  const min = parseFloat(parts[1]);
  let dd = deg + min / 60;
  if (dir === "S" || dir === "W") dd = -dd;
  return isNaN(dd) ? null : dd;
}

function extractLatLng(asset) {
  // Primary: asset.metadata (embedded EXIF)
  const meta = asset.metadata || {};
  const rawLat = meta["exif:GPSLatitude"] || meta["GPSLatitude"] || "";
  const rawLng = meta["exif:GPSLongitude"] || meta["GPSLongitude"] || "";

  if (rawLat && rawLng) {
    let lat = parseFloat(rawLat);
    let lng = parseFloat(rawLng);
    if (isNaN(lat) || isNaN(lng)) {
      lat = parseDMS(String(rawLat));
      lng = parseDMS(String(rawLng));
    }
    if (!isNaN(lat) && !isNaN(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return { lat, lng };
    }
  }

  // Fallback: custom attributes decimalLatitude / decimalLongitude
  const attrs = asset.attributes || {};
  const attrLat = (attrs.decimalLatitude || [])[0] || "";
  const attrLng = (attrs.decimalLongitude || [])[0] || "";
  if (attrLat && attrLng) {
    let lat = parseFloat(attrLat);
    let lng = parseFloat(attrLng);
    if (!isNaN(lat) && !isNaN(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
      return { lat, lng };
    }
  }

  return null;
}

(async () => {
  let allAssets = [], startIndex = 0, size = 100;

  console.log(`Fetching assets from folder ${FOLDER_ID}...`);

  while (true) {
    const result = await rpcCall("getAssetsByFolder", [
      FOLDER_ID,
      true,
      {
        page: { startIndex, size },
        data: ["asset.id", "asset.base", "asset.file", "asset.attributes"]
      }
    ]);
    const batch = (result && result.results) ? result.results : [];
    console.log(`  Got ${batch.length} assets (offset ${startIndex})`);
    allAssets = allAssets.concat(batch);
    if (batch.length < size) break;
    startIndex += size;
  }

  console.log(`Total assets fetched: ${allAssets.length}`);

  // Log first asset structure to help debug GPS field names
  if (allAssets.length > 0) {
    console.log("Sample asset structure:", JSON.stringify(allAssets[0], null, 2));
  console.log("Sample metadata:", JSON.stringify(allAssets[0].metadata, null, 2));
  }

  const geoAssets = allAssets
    .map(asset => {
      const ll = extractLatLng(asset);
      if (!ll) return null;
      return {
        id: asset.id,
        name: asset.base?.name || asset.file?.name || String(asset.id),
        lat: ll.lat,
        lng: ll.lng
      };
    })
    .filter(Boolean);

  console.log(`Assets with GPS: ${geoAssets.length} of ${allAssets.length}`);

  await fs.mkdir("site", { recursive: true });
  await fs.writeFile(
    "site/assets.json",
    JSON.stringify({ updated_at: new Date().toISOString(), assets: geoAssets }, null, 2),
    "utf8"
  );
  await fs.copyFile("index.html", "site/index.html");

  console.log(`Wrote ${geoAssets.length} geotagged assets to site/assets.json`);
})();
