/**
 * Standalone smoke test for the mock route endpoint. Boots a real Express
 * app on a random port, mounts our setupRouteMockRoutes, and asserts:
 *   1. Different facility_id / origin / dest → different traffic multipliers
 *   2. Same key called twice → identical bytes (cache hit)
 *   3. Same key on a fresh process reproduces the same multiplier (determinism)
 *   4. existing_polyline echoes back verbatim with polyline_source set to
 *      "dijkstra_provided"
 *   5. is_mock is true and eta = base_eta + traffic_delay
 *
 * Run with:  npx tsx --tsconfig tsconfig.server.json scripts/smoke-mock-route.ts
 */
import express, { type Application } from 'express';
import http from 'node:http';
import { setupRouteMockRoutes } from '../server/routes/route-mock';

interface AppKitLike {
  server: { extend(fn: (app: Application) => void): void };
}

function startApp(): Promise<{ port: number; server: http.Server }> {
  const app = express();
  app.use(express.json());
  const appkit: AppKitLike = {
    server: {
      extend(fn) {
        fn(app);
      },
    },
  };
  setupRouteMockRoutes(appkit);
  return new Promise((resolve) => {
    const server = app.listen(0, () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') resolve({ port: addr.port, server });
    });
  });
}

async function post(port: number, body: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`http://127.0.0.1:${port}/api/route/mock`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  return (await res.json()) as Record<string, unknown>;
}

function fail(message: string, ...rest: unknown[]): never {
  console.error('FAIL', message, ...rest);
  process.exit(1);
}

async function main(): Promise<void> {
  const { port, server } = await startApp();

  const jaipur = { lat: 26.9124, lon: 75.7873 };
  const mumbai = { lat: 19.076, lon: 72.8777 };

  const a = await post(port, {
    origin: jaipur,
    destination: { lat: 26.95, lon: 75.81 },
    facility_id: 'fac-A',
    facility_name: 'A Hospital',
  });
  const b = await post(port, {
    origin: mumbai,
    destination: { lat: 19.1, lon: 72.9 },
    facility_id: 'fac-B',
    facility_name: 'B Hospital',
  });

  console.log(
    'A: traffic=',
    a.traffic_level,
    ' mult=',
    a.traffic_multiplier,
    ' eta=',
    a.eta_minutes,
    ' base=',
    a.base_eta_minutes,
    ' dist=',
    a.distance_km
  );
  console.log(
    'B: traffic=',
    b.traffic_level,
    ' mult=',
    b.traffic_multiplier,
    ' eta=',
    b.eta_minutes,
    ' base=',
    b.base_eta_minutes,
    ' dist=',
    b.distance_km
  );

  if (a.traffic_multiplier === b.traffic_multiplier) {
    fail('different keys should produce different multipliers', a, b);
  }

  const aAgain = await post(port, {
    origin: jaipur,
    destination: { lat: 26.95, lon: 75.81 },
    facility_id: 'fac-A',
    facility_name: 'A Hospital',
  });
  if (JSON.stringify(a) !== JSON.stringify(aAgain)) {
    fail('cache hit must return identical payload', a, aAgain);
  }
  console.log('cache hit OK');

  server.close();
  const { port: port2, server: server2 } = await startApp();
  const aFresh = await post(port2, {
    origin: jaipur,
    destination: { lat: 26.95, lon: 75.81 },
    facility_id: 'fac-A',
    facility_name: 'A Hospital',
  });
  if (a.traffic_multiplier !== aFresh.traffic_multiplier) {
    fail('determinism broken across fresh process', a, aFresh);
  }
  console.log('determinism OK across fresh process');

  const withPoly = await post(port2, {
    origin: jaipur,
    destination: { lat: 26.95, lon: 75.81 },
    facility_id: 'fac-A',
    facility_name: 'A Hospital',
    existing_polyline: [
      [26.91, 75.79],
      [26.93, 75.8],
      [26.95, 75.81],
    ],
  });
  if (withPoly.polyline_source !== 'dijkstra_provided') {
    fail('existing_polyline should set polyline_source=dijkstra_provided', withPoly);
  }
  const poly = withPoly.route_polyline as unknown[];
  if (!Array.isArray(poly) || poly.length !== 3) {
    fail('existing_polyline echo length wrong', withPoly);
  }
  console.log('dijkstra polyline echo OK');

  const eta = a.eta_minutes as number;
  const base = a.base_eta_minutes as number;
  const delta = a.traffic_delay_minutes as number;
  if (Math.abs(eta - (base + delta)) > 0.2) {
    fail('eta != base + delta', { eta, base, delta });
  }
  console.log('arithmetic OK (eta == base + traffic_delay)');

  if (a.is_mock !== true) fail('is_mock must be true');
  if (typeof a.disclaimer !== 'string' || !a.disclaimer.toLowerCase().includes('simulated')) {
    fail('disclaimer must mention "simulated"', a);
  }
  console.log('disclaimer:', a.disclaimer);

  server2.close();
  console.log('\nALL SMOKE CHECKS PASSED');
}

void main();
