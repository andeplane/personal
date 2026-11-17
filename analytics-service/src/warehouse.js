import { BigQuery } from "@google-cloud/bigquery";
import {
  MAX_QUERY_BYTES,
  WAREHOUSE_LOCATION,
  warehouseTable,
} from "./warehouse-schema.js";
import { atomifyQuery } from "./atomify-query.js";

const counts = `COUNT(*) AS events, COUNT(DISTINCT IF(user_id IS NULL,NULL,CONCAT(app_id,':',user_id))) AS users, COUNT(DISTINCT IF(session_id IS NULL,NULL,CONCAT(app_id,':',session_id))) AS sessions`;
export function warehouseCtes(projectId) {
  return `WITH source AS (
    SELECT * FROM ${warehouseTable(projectId, "events")}
    WHERE event_date BETWEEN @scanFrom AND @to
  ), gaps AS (
    SELECT *, LAG(occurred_at) OVER(PARTITION BY app_id,user_id ORDER BY occurred_at,id) AS previous_at
    FROM source
  ), starts AS (
    SELECT *, MAX(IF(previous_at IS NULL OR TIMESTAMP_DIFF(occurred_at,previous_at,SECOND)>=1800,occurred_at,NULL))
      OVER(PARTITION BY app_id,user_id ORDER BY occurred_at,id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) AS inferred_start
    FROM gaps
  ), sessionized AS (
    SELECT *, COALESCE(reported_session_id,IF(user_id IS NULL,NULL,LOWER(TO_HEX(MD5(CONCAT(app_id,':',user_id,':',CAST(inferred_start AS STRING))))))) AS session_id,
      reported_session_id IS NULL AND user_id IS NOT NULL AS inferred_session
    FROM starts
  ), scoped AS (SELECT * FROM sessionized WHERE event_date>=@from),
  base AS (SELECT * FROM scoped WHERE (@appId='' OR app_id=@appId)),
  selected AS (SELECT * FROM base WHERE (@event='' OR name=@event) AND (@property='' OR JSON_VALUE(properties[@property])=@value)),
  sessions AS (SELECT app_id,session_id,ANY_VALUE(user_id) AS user_id,MIN(occurred_at) AS first_at,MAX(occurred_at) AS last_at,COUNT(*) AS events,LOGICAL_OR(inferred_session) AS inferred
    FROM selected WHERE session_id IS NOT NULL GROUP BY app_id,session_id),
  daily AS (SELECT event_date AS day,${counts} FROM selected GROUP BY day),
  user_days AS (SELECT DISTINCT app_id,user_id,event_date FROM base WHERE user_id IS NOT NULL),
  cohorts AS (SELECT app_id,user_id,MIN(event_date) AS first_day FROM user_days GROUP BY app_id,user_id),
  numbered AS (SELECT *,ROW_NUMBER() OVER(PARTITION BY app_id,user_id ORDER BY occurred_at,id) AS seq FROM base WHERE user_id IS NOT NULL)`;
}
export function warehouseQuery(projectId, steps = []) {
  let sql = warehouseCtes(projectId);
  if (steps.length) {
    sql += `, f0 AS (SELECT app_id,user_id,MIN(seq) AS seq,MIN(occurred_at) AS first_at FROM numbered WHERE name=@step0 GROUP BY app_id,user_id)`;
    for (let i = 1; i < steps.length; i++)
      sql += `, f${i} AS (SELECT p.app_id,p.user_id,MIN(e.seq) AS seq,ANY_VALUE(p.first_at) AS first_at FROM f${i - 1} p JOIN numbered e ON p.app_id=e.app_id AND p.user_id=e.user_id AND e.seq>p.seq AND e.occurred_at<=TIMESTAMP_ADD(p.first_at,INTERVAL 7 DAY) WHERE e.name=@step${i} GROUP BY p.app_id,p.user_id)`;
  }
  const funnel = steps.length
    ? `[${steps.map((_, i) => `STRUCT(@step${i} AS name,(SELECT COUNT(*) FROM f${i}) AS users)`).join(",")}]`
    : "ARRAY<STRUCT<name STRING, users INT64>>[]";
  return (
    sql +
    `
  SELECT TO_JSON_STRING(STRUCT(
    (SELECT AS STRUCT ${counts},COUNT(DISTINCT event_date) AS activeDays,COUNTIF(user_id IS NULL) AS eventsWithoutIdentity FROM selected) AS summary,
    (SELECT AS STRUCT
      COUNT(DISTINCT IF(event_date=@to AND (@event='' OR name=@event) AND (@property='' OR JSON_VALUE(properties[@property])=@value),IF(user_id IS NULL,NULL,CONCAT(app_id,':',user_id)),NULL)) AS dau,
      COUNT(DISTINCT IF(event_date>=@monthFrom AND (@event='' OR name=@event) AND (@property='' OR JSON_VALUE(properties[@property])=@value),IF(user_id IS NULL,NULL,CONCAT(app_id,':',user_id)),NULL)) AS mau
      FROM sessionized WHERE (@appId='' OR app_id=@appId)) AS active,
    ARRAY(SELECT AS STRUCT CAST(day AS STRING) AS day,COALESCE(d.events,0) AS events,COALESCE(d.users,0) AS users,COALESCE(d.sessions,0) AS sessions FROM UNNEST(GENERATE_DATE_ARRAY(@from,@to)) day LEFT JOIN daily d USING(day) ORDER BY day) AS days,
    ARRAY(SELECT AS STRUCT app_id AS appId,${counts},UNIX_MILLIS(MAX(occurred_at)) AS lastSeen FROM scoped GROUP BY app_id ORDER BY events DESC) AS apps,
    ARRAY(SELECT AS STRUCT CASE WHEN @breakdown='name' THEN name WHEN @breakdown='appId' THEN app_id ELSE COALESCE(JSON_VALUE(properties[@breakdown]),'(not set)') END AS label,${counts} FROM selected GROUP BY label ORDER BY events DESC,label LIMIT 50) AS \`groups\`,
    ARRAY(SELECT DISTINCT name FROM base ORDER BY name) AS eventNames,
    ARRAY(SELECT DISTINCT key FROM base,UNNEST(JSON_KEYS(properties,1)) key ORDER BY key) AS dimensions,
    ARRAY(SELECT AS STRUCT app_id AS appId,session_id AS sessionId,user_id AS userId,UNIX_MILLIS(first_at) AS first,UNIX_MILLIS(last_at) AS last,events,inferred FROM sessions ORDER BY last_at DESC,session_id LIMIT 100) AS sessions,
    ARRAY(SELECT AS STRUCT id,app_id AS appId,name,user_id AS userId,session_id AS sessionId,UNIX_MILLIS(occurred_at) AS occurredAt,properties,source,inferred_session AS inferredSession FROM selected ORDER BY occurred_at DESC,id LIMIT 200) AS events,
    ARRAY(SELECT AS STRUCT offset AS day,COUNTIF(DATE_ADD(first_day,INTERVAL offset DAY)<LEAST(DATE_ADD(@to,INTERVAL 1 DAY),CURRENT_DATE())) AS eligible,
      COUNTIF(DATE_ADD(first_day,INTERVAL offset DAY)<LEAST(DATE_ADD(@to,INTERVAL 1 DAY),CURRENT_DATE()) AND EXISTS(SELECT 1 FROM user_days d WHERE d.app_id=c.app_id AND d.user_id=c.user_id AND d.event_date=DATE_ADD(c.first_day,INTERVAL offset DAY))) AS returned
      FROM cohorts c CROSS JOIN UNNEST([1,7,28]) offset GROUP BY offset ORDER BY offset) AS retention,
    ${funnel} AS funnel,
    (SELECT AS STRUCT
      ARRAY(SELECT AS STRUCT b.label,COUNTIF(s.events>=b.low AND s.events<b.high) AS count FROM UNNEST([STRUCT('1' AS label,1 AS low,2 AS high),('2–4',2,5),('5–9',5,10),('10–19',10,20),('20–49',20,50),('50+',50,9223372036854775807)]) b LEFT JOIN sessions s ON TRUE GROUP BY b.label,b.low ORDER BY b.low) AS eventsPerSession,
      ARRAY(SELECT AS STRUCT b.label,COUNTIF(TIMESTAMP_DIFF(s.last_at,s.first_at,SECOND)>=b.low AND TIMESTAMP_DIFF(s.last_at,s.first_at,SECOND)<b.high) AS count FROM UNNEST([STRUCT('Under 1m' AS label,0 AS low,60 AS high),('1–4m',60,300),('5–14m',300,900),('15–29m',900,1800),('30–59m',1800,3600),('60m+',3600,9223372036854775807)]) b LEFT JOIN sessions s ON TRUE GROUP BY b.label,b.low ORDER BY b.low) AS sessionSpan) AS distributions,
    ARRAY(SELECT AS STRUCT source,source_project AS projectId,COUNT(*) AS events,MIN(CAST(event_date AS STRING)) AS firstDay,MAX(CAST(event_date AS STRING)) AS lastDay,COUNTIF(timestamp_ambiguous) AS ambiguousTimestamps FROM scoped GROUP BY source,source_project ORDER BY source,source_project) AS sources,
    (SELECT COUNTIF(inferred) FROM sessions) AS inferredSessions,
    (SELECT COUNT(*) FROM base) AS scanned
  )) AS payload`
  );
}

export class Warehouse {
  constructor({ projectId = "andershaf-87", bq } = {}) {
    this.projectId = projectId;
    this.bq = bq ?? new BigQuery({ projectId, location: WAREHOUSE_LOCATION });
  }
  parameters(range, filters = {}) {
    const monthFrom = range.to.slice(0, 7) + "-01";
    const scanFrom = range.from < monthFrom ? range.from : monthFrom;
    return {
      from: range.from,
      to: range.to,
      monthFrom,
      scanFrom,
      appId: filters.appId ?? "",
      event: filters.eventName ?? "",
      property: filters.property ?? "",
      value: filters.value ?? "",
      breakdown: filters.breakdown ?? "name",
    };
  }
  async execute(query, params) {
    const types = Object.fromEntries(
      Object.keys(params).map((key) => [
        key,
        ["from", "to", "monthFrom", "scanFrom"].includes(key)
          ? "DATE"
          : "STRING",
      ]),
    );
    const queryParams = Object.fromEntries(
      Object.entries(params).map(([key, value]) => [
        key,
        types[key] === "DATE" ? BigQuery.date(value) : value,
      ]),
    );
    const [job] = await this.bq.createQueryJob({
      query,
      params: queryParams,
      types,
      location: WAREHOUSE_LOCATION,
      maximumBytesBilled: MAX_QUERY_BYTES,
      jobTimeoutMs: 20000,
      useLegacySql: false,
    });
    const [rows] = await job.getQueryResults();
    return rows.map((row) => JSON.parse(row.payload));
  }
  async analyze(range, filters) {
    const steps = filters.funnel ?? [],
      params = this.parameters(range, filters);
    steps.forEach((name, i) => (params[`step${i}`] = name));
    const [[data], atomifyResult] = await Promise.all([
      this.execute(warehouseQuery(this.projectId, steps), params),
      filters.appId === "atomify"
        ? this.execute(atomifyQuery(this.projectId), {
            from: range.from,
            to: range.to,
          })
        : Promise.resolve(null),
    ]);
    data.retention = data.retention.map((row) => ({
      ...row,
      rate: row.eligible ? row.returned / row.eligible : null,
    }));
    return {
      ...data,
      atomify: atomifyResult?.[0] ?? null,
      range: { from: range.from, to: range.to },
      complete: true,
      engine: "warehouse",
      selectedCount: data.summary.events,
      scope:
        "App-scoped pseudonymous identities. Events without identity are included in event counts and excluded from users and inferred sessions. Dates are UTC.",
      active: {
        ...data.active,
        dauDate: range.to,
        mauFrom: params.monthFrom,
        mauTo: range.to,
      },
      sessionScope:
        "Reported session IDs where available; otherwise sessions inferred from 30 minutes of inactivity for a known app-scoped identity. Inferred sessions are observed within the queried month/window, not measured attention.",
      retentionScope:
        "Day N return to the same app after first observed activity in this window; only fully elapsed follow-up days are eligible. Not lifetime acquisition retention.",
      funnelScope:
        "Ordered events from the same app and pseudonymous identity, within seven days of the first step and within this window. Uses app and dates independently of event/property filters.",
    };
  }
  async session(appId, sessionId, range) {
    const params = { ...this.parameters(range, { appId }), sessionId };
    const [result] = await this.execute(
      warehouseCtes(this.projectId) +
        ` SELECT TO_JSON_STRING(STRUCT(COUNT(*)<=2000 AS complete,ARRAY_AGG(STRUCT(id,app_id AS appId,name,user_id AS userId,session_id AS sessionId,UNIX_MILLIS(occurred_at) AS occurredAt,properties) ORDER BY occurred_at,id LIMIT 2000) AS events)) AS payload FROM base WHERE session_id=@sessionId`,
      params,
    );
    return { ...result, events: result.events ?? [] };
  }
}
