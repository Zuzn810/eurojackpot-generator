const MONTHS = {
  January: 1, February: 2, March: 3, April: 4, May: 5, June: 6,
  July: 7, August: 8, September: 9, October: 10, November: 11, December: 12
};

function parseYearHtml(html) {
  const dateRe = /<div class="date"><span>\w+<\/span>\s*([A-Za-z]+)\s+(\d+)\w*\s+(\d{4})<\/div>/g;
  const matches = [];
  let m;
  while ((m = dateRe.exec(html)) !== null) {
    matches.push({ index: m.index, len: m[0].length, month: m[1], day: m[2], year: m[3] });
  }

  const draws = [];
  for (let i = 0; i < matches.length; i++) {
    const cur = matches[i];
    const start = cur.index + cur.len;
    const end = i + 1 < matches.length ? matches[i + 1].index : html.length;
    const block = html.slice(start, end);

    const ballRe = /<li class="ball\s+(ball|euro)">\s*<span>(\d+)<\/span>/g;
    const balls = [];
    let bm;
    while ((bm = ballRe.exec(block)) !== null) balls.push({ type: bm[1], val: parseInt(bm[2], 10) });

    const main = balls.filter((b) => b.type === "ball").map((b) => b.val);
    const euro = balls.filter((b) => b.type === "euro").map((b) => b.val);
    if (main.length !== 5 || euro.length !== 2) continue;

    const mm = String(MONTHS[cur.month]).padStart(2, "0");
    const dd = String(parseInt(cur.day, 10)).padStart(2, "0");
    draws.push({
      date: `${cur.year}-${mm}-${dd}`,
      main: main.slice().sort((a, b) => a - b),
      euro: euro.slice().sort((a, b) => a - b)
    });
  }
  return draws;
}

function describeError(err) {
  const parts = [String((err && err.message) || err)];
  if (err && err.cause) parts.push("cause: " + String(err.cause && err.cause.message ? err.cause.message : err.cause));
  if (err && err.code) parts.push("code: " + err.code);
  return parts.join(" | ");
}

async function fetchOnce(url, timeoutMs) {
  const res = await fetch(url, {
    headers: {
      "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0 Safari/537.36",
      "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9"
    },
    signal: AbortSignal.timeout(timeoutMs)
  });
  return res;
}

async function fetchYear(year) {
  const url = `https://www.lotto.net/eurojackpot/results/${year}`;
  let lastErr;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetchOnce(url, 8000);
      if (!res.ok) return { year, draws: [], httpStatus: res.status };
      const html = await res.text();
      return { year, draws: parseYearHtml(html) };
    } catch (err) {
      lastErr = err;
    }
  }
  return { year, draws: [], error: describeError(lastErr) };
}

exports.handler = async function () {
  const now = new Date();
  const year = now.getUTCFullYear();
  try {
    const results = await Promise.all([fetchYear(year - 1), fetchYear(year)]);

    const byDate = {};
    results.forEach((r) => r.draws.forEach((d) => { byDate[d.date] = d; }));
    const draws = Object.keys(byDate).map((k) => byDate[k]).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));

    const issues = results.filter((r) => r.error || r.httpStatus).map((r) => ({ year: r.year, error: r.error, httpStatus: r.httpStatus }));

    if (draws.length === 0 && issues.length) {
      return {
        statusCode: 502,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ error: "upstream fetch failed for all years", issues })
      };
    }

    return {
      statusCode: 200,
      headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=1800" },
      body: JSON.stringify({ draws, fetchedAt: now.toISOString(), issues: issues.length ? issues : undefined })
    };
  } catch (err) {
    return {
      statusCode: 500,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ error: describeError(err) })
    };
  }
};
