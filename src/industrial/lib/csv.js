// 브라우저용 CSV 파서 (UTF-8 / CP949 자동 판별, 따옴표·구분자 자동 감지)

export async function readTextFile(file) {
    const buf = await file.arrayBuffer();
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(buf).replace(/^﻿/, '');
    } catch {
        return new TextDecoder('euc-kr').decode(buf); // CP949(엑셀 CSV 기본 인코딩)
    }
}

function detectDelimiter(firstLine) {
    const counts = [',', '\t', ';', '|'].map((d) => [d, firstLine.split(d).length - 1]);
    counts.sort((a, b) => b[1] - a[1]);
    return counts[0][1] > 0 ? counts[0][0] : ',';
}

export function parseCsv(text) {
    const firstLine = text.split(/\r?\n/, 1)[0] || '';
    const delim = detectDelimiter(firstLine);
    const rows = [];
    let row = [];
    let cur = '';
    let inQ = false;
    for (let i = 0; i < text.length; i++) {
        const ch = text[i];
        if (inQ) {
            if (ch === '"') {
                if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false;
            } else cur += ch;
        } else if (ch === '"') inQ = true;
        else if (ch === delim) { row.push(cur); cur = ''; }
        else if (ch === '\n' || ch === '\r') {
            if (ch === '\r' && text[i + 1] === '\n') i++;
            row.push(cur); cur = '';
            if (row.some((c) => c.trim() !== '')) rows.push(row);
            row = [];
        } else cur += ch;
    }
    row.push(cur);
    if (row.some((c) => c.trim() !== '')) rows.push(row);
    if (!rows.length) return { headers: [], records: [] };
    const headers = rows[0].map((h, i) => (h.trim() || `열${i + 1}`));
    const seen = {};
    const uniq = headers.map((h) => { seen[h] = (seen[h] || 0) + 1; return seen[h] > 1 ? `${h}_${seen[h]}` : h; });
    const records = rows.slice(1).map((r) => Object.fromEntries(uniq.map((h, i) => [h, (r[i] ?? '').trim()])));
    return { headers: uniq, records };
}

// 헤더 이름으로 열 역할 추정
const GUESS = {
    address: [/^(소재지|주소|도로명주소|지번주소|address|addr)$/i, /주소|소재지|지번|address|addr|location/i],
    name: [/^(상호|업체명|기업명|회사명|시설명|명칭|name)$/i, /업체|기업|회사|상호|시설|명칭|name|company/i],
    lotNo: [/^(지번|필지|필지번호|lot|lotno)$/i, /필지|lot/i],
    area: [/^(면적|대지면적|토지면적|area)$/i, /면적|area/i],
    lon: [/^(경도|lon|lng|longitude|x)$/i],
    lat: [/^(위도|lat|latitude|y)$/i],
    category: [/^(업종|용도|유형|구분|type|category)$/i, /업종|용도|유형|구분/i],
};

export function guessColumns(headers) {
    const out = {};
    for (const [role, pats] of Object.entries(GUESS)) {
        for (const re of pats) {
            const h = headers.find((x) => re.test(x));
            if (h) { out[role] = h; break; }
        }
    }
    // 같은 열을 두 역할이 가리키면 우선순위(주소 > 이름 > 나머지)로 정리
    if (out.lotNo && out.lotNo === out.address) delete out.lotNo;
    if (out.name && out.name === out.address) delete out.name;
    return out;
}

export const SAMPLE_CSV = '업체명,주소,대지면적,업종\n(주)샘플정밀,강원특별자치도 원주시 문막읍 문막리 1234-5,2400,제조\n한빛물류,강원특별자치도 원주시 지정면 가곡리 567,5200,물류\n';

export function downloadText(filename, text) {
    const blob = new Blob(['﻿', text], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}
