import { warehouseTable } from "./warehouse-schema.js";
export function atomifyQuery(projectId) {
  return `WITH events AS (SELECT * FROM ${warehouseTable(projectId, "events")} WHERE event_date BETWEEN @from AND @to AND app_id='atomify'),
    stops AS (SELECT *,SAFE_CAST(JSON_VALUE(properties.durationSeconds) AS FLOAT64) AS duration,
      SAFE_CAST(JSON_VALUE(properties.numAtoms) AS FLOAT64) AS atoms,
      SAFE_CAST(JSON_VALUE(properties.timestepsPerSecond) AS FLOAT64) AS speed,
      SAFE_CAST(JSON_VALUE(properties.timesteps) AS FLOAT64) AS timesteps
      FROM events WHERE name='Simulation.Stop'),
    metrics AS (SELECT * FROM stops WHERE duration>=0 OR atoms>=0 OR speed>=0)
    SELECT TO_JSON_STRING(STRUCT(
      (SELECT AS STRUCT COUNTIF(name='Simulation.Start') AS simulationStarts,COUNTIF(name='Simulation.Stop') AS simulationStops,
        COUNTIF(name='Run.Start') AS runStarts,COUNTIF(name='Run.Finish') AS runFinishes,COUNTIF(name='Project.New') AS projectsCreated,
        COUNTIF(name='Example.UseAsProject') AS examplesAdopted,COUNTIF(name='QuickRun.Start') AS quickRuns,COUNTIF(name='Sweep.Create') AS sweeps
        FROM events) AS usage,
      ARRAY(SELECT AS STRUCT COALESCE(JSON_VALUE(properties.stopReason),'(not recorded)') AS label,COUNT(*) AS events FROM stops GROUP BY label ORDER BY events DESC,label) AS outcomes,
      (SELECT AS STRUCT COUNT(*) AS stops,COUNTIF(duration>=0) AS durationSamples,AVG(IF(duration>=0,duration,NULL)) AS averageDuration,
        APPROX_QUANTILES(IF(duration>=0,duration,NULL),100)[SAFE_OFFSET(50)] AS medianDuration,
        APPROX_QUANTILES(IF(duration>=0,duration,NULL),100)[SAFE_OFFSET(95)] AS p95Duration,
        COUNTIF(atoms>=0) AS atomSamples,MAX(IF(atoms>=0,atoms,NULL)) AS maxAtoms,
        COUNTIF(speed>=0) AS speedSamples,APPROX_QUANTILES(IF(speed>=0,speed,NULL),100)[SAFE_OFFSET(50)] AS medianSpeed,
        APPROX_QUANTILES(IF(speed>=0,speed,NULL),100)[SAFE_OFFSET(95)] AS p95Speed,
        SUM(IF(timesteps>=0,timesteps,NULL)) AS timesteps
        FROM stops) AS performance,
      ARRAY(SELECT AS STRUCT CAST(event_date AS STRING) AS day,COUNTIF(name='Simulation.Start') AS starts,COUNTIF(name='Simulation.Stop') AS stops,COUNTIF(name='Simulation.Stop' AND JSON_VALUE(properties.stopReason)='failed') AS failures FROM events GROUP BY event_date ORDER BY event_date) AS daily,
      ARRAY(SELECT AS STRUCT COALESCE(JSON_VALUE(properties.exampleId),'(not recorded)') AS label,COUNT(*) AS events,COUNT(DISTINCT user_id) AS users FROM events WHERE name IN ('QuickRun.Start','Example.UseAsProject','Run.Start') GROUP BY label ORDER BY events DESC,label LIMIT 50) AS examples,
      ARRAY(SELECT AS STRUCT SPLIT(name,'.')[SAFE_OFFSET(0)] AS label,COUNT(*) AS events,COUNT(DISTINCT user_id) AS users FROM events GROUP BY label ORDER BY events DESC,label LIMIT 50) AS features,
      ARRAY(SELECT AS STRUCT b.label,COUNTIF(s.duration>=b.low AND s.duration<b.high) AS count FROM UNNEST([STRUCT('Under 1s' AS label,0.0 AS low,1.0 AS high),('1–9s',1.,10.),('10–59s',10.,60.),('1–4m',60.,300.),('5–29m',300.,1800.),('30m+',1800.,1e100)]) b LEFT JOIN stops s ON TRUE GROUP BY b.label,b.low ORDER BY b.low) AS durations,
      ARRAY(SELECT AS STRUCT b.label,COUNTIF(s.atoms>=b.low AND s.atoms<b.high) AS count FROM UNNEST([STRUCT('Under 1k' AS label,0.0 AS low,1000.0 AS high),('1k–9k',1000.,10000.),('10k–99k',10000.,100000.),('100k–999k',100000.,1000000.),('1M+',1000000.,1e100)]) b LEFT JOIN stops s ON TRUE GROUP BY b.label,b.low ORDER BY b.low) AS sizes
    )) AS payload`;
}
