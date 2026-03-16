const CACHE_DURATION_MS = 3 * 24 * 60 * 60 * 1000;
const CACHE_PREFIX = 'davidson_rmp_v1_';
const SCHOOL_ID = 'U2Nob29sLTM5NjU='; // Davidson College

const REPLACEMENTS = {
  'B.J. Shaw': 'B J Shaw',
  'BJ Shaw': 'B J Shaw',
  'Jeanne Marie Linker': 'Jeanne-Marie Linker',
  'Hamid Baradaran Shoraka': 'Hamid Shoraka'
};

const NAME_OVERRIDES = {
  'Tsai M': 'Yiting Tsai',
  'Staff S': 'Stephen Staff'
};

function normalizeWhitespace(value) {
  return (value || '').replace(/\s+/g, ' ').trim();
}

function normalizeName(value) {
  return normalizeWhitespace(value)
    .replace(/\(.*?\)/g, '')
    .replace(/^(prof\.?|professor)\s+/i, '')
    .replace(/,\s*(ph\.?d\.?|md|mfa|ma|ms|mba|jd)\b/gi, '')
    .replace(/\b(ph\.?d\.?|md|mfa|ma|ms|mba|jd)\b/gi, '')
    .replace(/[.'’]/g, '')
    .replace(/-/g, ' ')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function applyReplacements(rawName) {
  const compact = normalizeWhitespace(rawName);
  return REPLACEMENTS[compact] || rawName;
}

function applyOverrides(rawName) {
  const compact = normalizeWhitespace(rawName);
  return NAME_OVERRIDES[compact] || rawName;
}

function levenshtein(a, b) {
  const s = a || '';
  const t = b || '';
  const dp = Array.from({ length: s.length + 1 }, () => new Array(t.length + 1).fill(0));

  for (let i = 0; i <= s.length; i++) dp[i][0] = i;
  for (let j = 0; j <= t.length; j++) dp[0][j] = j;

  for (let i = 1; i <= s.length; i++) {
    for (let j = 1; j <= t.length; j++) {
      const cost = s[i - 1] === t[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1,
        dp[i][j - 1] + 1,
        dp[i - 1][j - 1] + cost
      );
    }
  }

  return dp[s.length][t.length];
}

function lastNamesCloseEnough(a, b) {
  if (!a || !b) return false;
  if (a === b) return true;

  const distance = levenshtein(a, b);
  const maxLen = Math.max(a.length, b.length);

  if (maxLen <= 4) return distance === 0;
  if (maxLen <= 8) return distance <= 1;
  return distance <= 2;
}

function tokenizedLastNamesCloseEnough(a, b) {
  if (!a || !b) return false;
  if (lastNamesCloseEnough(a, b)) return true;

  const aTokens = a.split(' ').filter(Boolean);
  const bTokens = b.split(' ').filter(Boolean);

  if (!aTokens.length || !bTokens.length) return false;
  if (aTokens.length !== bTokens.length) return false;

  for (let i = 0; i < aTokens.length; i++) {
    if (!lastNamesCloseEnough(aTokens[i], bTokens[i])) {
      return false;
    }
  }

  return true;
}

function parseSearchName(raw) {
  const clean = normalizeName(raw);
  const lower = clean.toLowerCase();
  const parts = lower.split(' ').filter(Boolean);

  let first = parts[0] || '';
  let last = parts[parts.length - 1] || '';
  let order = 'first-last';

  if (clean.includes(',')) {
    const [lastPart, firstPart] = clean
      .split(',')
      .map(s => normalizeName(s).toLowerCase())
      .filter(Boolean);

    if (lastPart && firstPart) {
      last = lastPart;
      first = firstPart.split(' ').filter(Boolean)[0] || firstPart;
      order = 'last-first-comma';
    }
  } else if (parts.length >= 2 && parts[parts.length - 1].length === 1) {
    first = parts[parts.length - 1];
    last = parts.slice(0, -1).join(' ');
    order = 'last-first-initial';
  }

  return { clean, lower, parts, first, last, order };
}

function parseRmpName(firstName, lastName) {
  const first = normalizeName(firstName).toLowerCase();
  const last = normalizeName(lastName).toLowerCase();
  return {
    first,
    last,
    full: `${first} ${last}`.trim(),
    firstInitial: first ? first[0] : ''
  };
}

function initialMatches(a, b) {
  return !!a && !!b && a[0] === b[0];
}

function namesMatch(searchName, firstName, lastName) {
  const search = parseSearchName(searchName);
  const rmp = parseRmpName(firstName, lastName);

  if (!search.clean || !rmp.full) return false;
  if (search.lower === rmp.full) return true;

  if (search.last && rmp.last && !tokenizedLastNamesCloseEnough(search.last, rmp.last)) {
    return false;
  }

  if (search.first && rmp.first) {
    if (search.first === rmp.first) return true;
    if (rmp.first.startsWith(search.first) || search.first.startsWith(rmp.first)) return true;
    if (initialMatches(search.first, rmp.first)) return true;
  }

  if (search.parts.length === 2) {
    const reversedFirst = search.parts[1];
    const reversedLast = search.parts[0];

    if (tokenizedLastNamesCloseEnough(reversedLast, rmp.last)) {
      if (reversedFirst === rmp.first) return true;
      if (rmp.first.startsWith(reversedFirst) || reversedFirst.startsWith(rmp.first)) return true;
      if (initialMatches(reversedFirst, rmp.first)) return true;
    }
  }

  return false;
}

function buildSearchTexts(rawName) {
  const replaced = applyReplacements(rawName);
  const parsed = parseSearchName(replaced);
  const variants = new Set();

  if (parsed.clean) variants.add(parsed.clean);
  if (parsed.last) variants.add(parsed.last);

  if (parsed.first && parsed.last) {
    variants.add(`${parsed.first} ${parsed.last}`);
    variants.add(`${parsed.last} ${parsed.first}`);
  }

  if (parsed.parts.length >= 2) {
    variants.add(parsed.parts.join(' '));
    variants.add(parsed.parts.slice().reverse().join(' '));
  }

  return Array.from(variants).filter(Boolean);
}

function getCacheKey(name) {
  return `${CACHE_PREFIX}${normalizeName(name).toLowerCase()}`;
}

async function getCached(name) {
  const key = getCacheKey(name);
  const stored = await chrome.storage.local.get(key);
  const entry = stored[key];

  if (!entry) return null;

  if ((Date.now() - entry.timestamp) > CACHE_DURATION_MS) {
    await chrome.storage.local.remove(key);
    return null;
  }

  return entry.data;
}

async function setCached(name, data) {
  const key = getCacheKey(name);
  await chrome.storage.local.set({
    [key]: {
      data,
      timestamp: Date.now()
    }
  });
}

async function runTeacherSearch(searchText) {
  const query = `
    query TeacherSearch($query: TeacherSearchQuery!, $ratingsFirst: Int!) {
      newSearch {
        teachers(query: $query) {
          edges {
            node {
              id
              legacyId
              firstName
              lastName
              department
              avgRating
              avgDifficulty
              wouldTakeAgainPercent
              numRatings
              teacherRatingTags {
                tagName
                tagCount
              }
              ratings(first: $ratingsFirst) {
                edges {
                  node {
                    comment
                    class
                    date
                    helpfulRating
                    difficultyRating
                    grade
                    thumbsUpTotal
                    thumbsDownTotal
                    wouldTakeAgain
                  }
                }
              }
            }
          }
        }
      }
    }
  `;

  const response = await fetch('https://www.ratemyprofessors.com/graphql', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Origin': 'https://www.ratemyprofessors.com',
      'Referer': 'https://www.ratemyprofessors.com/'
    },
    body: JSON.stringify({
      query,
      variables: {
        query: {
          text: searchText,
          schoolID: SCHOOL_ID
        },
        ratingsFirst: 3
      }
    })
  });

  if (!response.ok) {
    throw new Error(`RMP request failed (${response.status})`);
  }

  const payload = await response.json();

  if (payload.errors?.length) {
    throw new Error(payload.errors[0].message || 'RMP GraphQL error');
  }

  return (payload?.data?.newSearch?.teachers?.edges || [])
    .map(edge => edge.node)
    .filter(Boolean);
}

async function fetchProfessorFromRMP(rawName) {
  const replacedName = applyReplacements(rawName);
  const lookupName = applyOverrides(replacedName);

  const cached = await getCached(lookupName);
  if (cached !== null) return cached;

  const searchTexts = buildSearchTexts(lookupName);
  const allCandidates = [];
  const seenIds = new Set();

  for (const text of searchTexts) {
    const candidates = await runTeacherSearch(text);

    for (const node of candidates) {
      const key = String(node.legacyId || node.id || `${node.firstName}-${node.lastName}`);
      if (!seenIds.has(key)) {
        seenIds.add(key);
        allCandidates.push(node);
      }
    }

    const directMatches = allCandidates.filter(node =>
      namesMatch(lookupName, node.firstName, node.lastName)
    );

    if (directMatches.length) break;
  }

  const matches = allCandidates.filter(node =>
    namesMatch(lookupName, node.firstName, node.lastName)
  );

  if (!matches.length) {
    await setCached(lookupName, null);
    return null;
  }

  const best = matches.sort((a, b) => (b.numRatings || 0) - (a.numRatings || 0))[0];

  const reviews = (best.ratings?.edges || [])
    .map(edge => edge.node)
    .filter(Boolean)
    .filter(review => normalizeWhitespace(review.comment).length > 0)
    .slice(0, 2)
    .map(review => ({
      comment: normalizeWhitespace(review.comment),
      className: normalizeWhitespace(review.class),
      date: review.date || null,
      helpfulRating: review.helpfulRating ?? null,
      difficultyRating: review.difficultyRating ?? null,
      grade: review.grade || null,
      thumbsUpTotal: review.thumbsUpTotal ?? null,
      thumbsDownTotal: review.thumbsDownTotal ?? null,
      wouldTakeAgain: review.wouldTakeAgain ?? null
    }));

  const result = {
    legacyId: best.legacyId,
    firstName: best.firstName,
    lastName: best.lastName,
    department: best.department,
    avgRating: best.avgRating,
    avgDifficulty: best.avgDifficulty,
    wouldTakeAgainPercent: best.wouldTakeAgainPercent,
    numRatings: best.numRatings,
    tags: (best.teacherRatingTags || []).slice(0, 5),
    reviews,
    profileUrl: `https://www.ratemyprofessors.com/professor/${best.legacyId}`
  };

  await setCached(lookupName, result);
  return result;
}

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request?.type !== 'LOOKUP_PROFESSOR' || !request.professorName) return;

  fetchProfessorFromRMP(request.professorName)
    .then(data => sendResponse({ success: true, data }))
    .catch(error => sendResponse({ success: false, error: error.message }));

  return true;
});