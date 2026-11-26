# Third-party notices

The web scaffold was generated with the official `create-next-app` CLI. Direct dependencies are listed in package manifests; transitive dependency notices are managed by their package distributions and the lockfile.

The default Next.js scaffold SVG marks and favicon have been retained in `apps/web/public` and `apps/web/src/app`. Review the upstream Next.js template and bundled asset licenses before redistribution of those assets. No runtime third-party source was copied into the API or contracts package.

The API's Python runtime dependencies, including psycopg, are resolved in `services/api/uv.lock`. Optional local Compose images are pinned in `docker-compose.yml`: pgvector/PostgreSQL, NATS, Temporal, Neo4j Community, and OpenTelemetry Collector. Their upstream licenses and notices remain with the respective image distributions; review them before redistribution or deployment.

`tests/fixtures/world/TITAN-WTP-01/` contains original generated synthetic data, manuals, and schematic SVG inspection illustrations, licensed CC0-1.0 in its manifest. It contains no third-party manuals or photographs.
