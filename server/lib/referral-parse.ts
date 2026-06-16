const CITY_COORDS: Record<string, [number, number]> = {
  delhi: [28.6139, 77.209],
  'new delhi': [28.6139, 77.209],
  mumbai: [19.076, 72.8777],
  bombay: [19.076, 72.8777],
  bengaluru: [12.9716, 77.5946],
  bangalore: [12.9716, 77.5946],
  chennai: [13.0827, 80.2707],
  madras: [13.0827, 80.2707],
  kolkata: [22.5726, 88.3639],
  calcutta: [22.5726, 88.3639],
  hyderabad: [17.385, 78.4867],
  jaipur: [26.9124, 75.7873],
  patna: [25.5941, 85.1376],
  pune: [18.5204, 73.8567],
  ahmedabad: [23.0225, 72.5714],
  lucknow: [26.8467, 80.9462],
  bhopal: [23.2599, 77.4126],
  kochi: [9.9312, 76.2673],
  ernakulam: [9.9816, 76.2999],
  thiruvananthapuram: [8.5241, 76.9366],
  chandigarh: [30.7333, 76.7794],
  indore: [22.7196, 75.8577],
  nagpur: [21.1458, 79.0882],
  surat: [21.1702, 72.8311],
  vadodara: [22.3072, 73.1812],
  coimbatore: [11.0168, 76.9558],
  guwahati: [26.1445, 91.7362],
  bhubaneswar: [20.2961, 85.8245],
  ranchi: [23.3441, 85.3096],
  raipur: [21.2514, 81.6296],
  varanasi: [25.3176, 82.9739],
  agra: [27.1767, 78.0081],
  amritsar: [31.634, 74.8723],
  srinagar: [34.0837, 74.7973],
  jammu: [32.7266, 74.857],
};

const CARE_NEED_PATTERNS: Array<{ pattern: RegExp; careNeed: string; careType: string }> = [
  { pattern: /\bdialysis\b|\bkidney\b|\brenal\b|\bnephrolog/i, careNeed: 'dialysis', careType: 'specialist' },
  { pattern: /\bemergenc(?:y|ies)\b|\btrauma\b|\baccident\b|\b24[^a-z]*7\b/i, careNeed: 'emergency', careType: 'emergency' },
  { pattern: /\bsurgery\b|\bsurgical\b|\boperation\b/i, careNeed: 'surgery', careType: 'specialist' },
  { pattern: /\bmaternit(?:y|ies)\b|\bpregnan(?:cy|t)\b|\bantenatal\b|\bobstetric/i, careNeed: 'pregnancy', careType: 'maternity' },
  { pattern: /\bcardiolog|\bheart\b|\bcardiac\b|\bcoronary\b/i, careNeed: 'heart', careType: 'specialist' },
  { pattern: /\boncolog|\bcancer\b|\btumou?r\b/i, careNeed: 'cancer', careType: 'specialist' },
  { pattern: /\bdiabet|\bendocrin/i, careNeed: 'diabetes', careType: 'chronic' },
  { pattern: /\bp(?:a)?ediatric|\bchild(?:ren)?\b|\bneonatal\b/i, careNeed: 'child', careType: 'specialist' },
  { pattern: /\bgeneral\b|\bclinic\b|\bcheck[- ]?up\b|\bopd\b/i, careNeed: 'general', careType: 'general' },
];

const DEFAULT_RANKING = 'prioritize_evidence';
const DEFAULT_MAX_DISTANCE_KM = 75;
const DEFAULT_TOP_N = 10;

function detectCareNeed(message: string): { careNeed: string | null; careType: string | null } {
  for (const { pattern, careNeed, careType } of CARE_NEED_PATTERNS) {
    if (pattern.test(message)) return { careNeed, careType };
  }
  return { careNeed: null, careType: null };
}

function detectLocation(message: string): {
  locationText: string | null;
  lat: number | null;
  lon: number | null;
} {
  const lower = message.toLowerCase();
  const near = /\bnear\s+([a-zA-Z][a-zA-Z\s]{2,40}?)(?:[.,!?]|$)/i.exec(lower);
  if (near) {
    const fragment = near[1].trim().toLowerCase();
    const cities = Object.keys(CITY_COORDS).sort((a, b) => b.length - a.length);
    for (const city of cities) {
      if (city === fragment || fragment.includes(city)) {
        const [lat, lon] = CITY_COORDS[city];
        return { locationText: city.replace(/\b\w/g, (c) => c.toUpperCase()), lat, lon };
      }
    }
  }

  const cities = Object.keys(CITY_COORDS).sort((a, b) => b.length - a.length);
  for (const city of cities) {
    if (lower.includes(city)) {
      const [lat, lon] = CITY_COORDS[city];
      return { locationText: city.replace(/\b\w/g, (c) => c.toUpperCase()), lat, lon };
    }
  }
  return { locationText: null, lat: null, lon: null };
}

function detectMaxDistance(message: string): number | null {
  const within = /\bwithin\s+(\d{1,4})\s*km\b/i.exec(message);
  if (within) return Number(within[1]);
  const km = /\b(\d{1,4})\s*km\s+(?:radius|away|max|nearby)\b/i.exec(message);
  if (km) return Number(km[1]);
  return null;
}

function detectTopN(message: string): number | null {
  const top = /\btop\s+(\d{1,2})\b/i.exec(message);
  if (top) return Math.max(1, Math.min(Number(top[1]), 30));
  return null;
}

function detectPriority(message: string): string {
  const lower = message.toLowerCase();
  if (lower.includes('closest') || lower.includes('nearest') || lower.includes('prioritize distance')) {
    return 'prioritize_distance';
  }
  if (lower.includes('most trusted') || lower.includes('trust')) return 'prioritize_trust';
  if (lower.includes('best evidence') || lower.includes('most evidence')) return 'prioritize_evidence';
  return DEFAULT_RANKING;
}

export interface ReferralParseOk {
  ok: true;
  care_need: string;
  care_type: string;
  location_text: string | null;
  user_lat: number;
  user_lon: number;
  ranking_priority: string;
  max_distance_km: number;
  top_n: number;
  needs_clarification: null;
}

export type ReferralParseResult =
  | ReferralParseOk
  | {
      ok: false;
      kind: 'empty_message' | 'needs_clarification';
      needs_clarification?: 'location' | 'care_need' | 'both';
      message?: string;
      care_need?: string | null;
      care_type?: string | null;
      location_text?: string | null;
      user_lat?: number | null;
      user_lon?: number | null;
    };

export function parseReferralMessage(message: string): ReferralParseResult {
  const trimmed = message.trim();
  if (!trimmed) {
    return {
      ok: false,
      kind: 'empty_message',
      message: 'Empty message — please type a referral request.',
    };
  }

  const { careNeed, careType } = detectCareNeed(trimmed);
  const { locationText, lat, lon } = detectLocation(trimmed);
  const maxDistance = detectMaxDistance(trimmed) ?? DEFAULT_MAX_DISTANCE_KM;
  const topN = detectTopN(trimmed) ?? DEFAULT_TOP_N;
  const priority = detectPriority(trimmed);

  if (!careNeed && lat == null) {
    return {
      ok: false,
      kind: 'needs_clarification',
      needs_clarification: 'both',
      message:
        'I could not identify a care need or a location in that message. Try, for example: "dialysis near Jaipur".',
    };
  }
  if (!careNeed) {
    return {
      ok: false,
      kind: 'needs_clarification',
      needs_clarification: 'care_need',
      location_text: locationText,
      user_lat: lat,
      user_lon: lon,
      message: `I picked up a location but not a care need. Try "dialysis near ${locationText ?? 'this city'}".`,
    };
  }
  if (lat == null || lon == null) {
    return {
      ok: false,
      kind: 'needs_clarification',
      needs_clarification: 'location',
      care_need: careNeed,
      care_type: careType,
      message: `I picked up the care need (${careNeed}) but not a location. Try "${careNeed} near Mumbai".`,
    };
  }

  return {
    ok: true,
    care_need: careNeed,
    care_type: careType ?? 'specialist',
    location_text: locationText,
    user_lat: lat,
    user_lon: lon,
    ranking_priority: priority,
    max_distance_km: maxDistance,
    top_n: topN,
    needs_clarification: null,
  };
}

export async function resolveCityFromLakebase(
  query: (
    text: string,
    params?: unknown[]
  ) => Promise<{ rows: Record<string, unknown>[] }>,
  cityName: string
): Promise<{ lat: number; lon: number } | null> {
  try {
    const result = await query(
      `SELECT AVG(f.latitude)::float AS lat, AVG(f.longitude)::float AS lon
       FROM ${process.env.CAREPILOT_LAKEBASE_SCHEMA ?? 'healthcare'}.facilities f
       WHERE LOWER(TRIM(f.address_city)) = LOWER(TRIM($1))
         AND f.latitude IS NOT NULL AND f.longitude IS NOT NULL`,
      [cityName]
    );
    const row = result.rows[0];
    const lat = Number(row?.lat);
    const lon = Number(row?.lon);
    if (Number.isFinite(lat) && Number.isFinite(lon)) return { lat, lon };
  } catch {
    // fall through to static city table
  }
  return null;
}
