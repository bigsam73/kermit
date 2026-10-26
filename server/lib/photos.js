// 드론 촬영 사진 인덱싱: 폴더를 훑어 EXIF GPS/시각/기체 정보를 추출하고 썸네일을 만든다.
// DJI 열화상(_T.jpeg)·가시광(_V/_W.jpeg) 모두 지원.
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import exifr from 'exifr';

const IMAGE_EXT = new Set(['.jpg', '.jpeg', '.png', '.tif', '.tiff']);

export function walkImages(dir, limit = 3000, depth = 4) {
    const out = [];
    const visit = (d, level) => {
        if (out.length >= limit || level > depth) return;
        let entries = [];
        try {
            entries = fs.readdirSync(d, { withFileTypes: true });
        } catch {
            return;
        }
        for (const e of entries) {
            if (out.length >= limit) return;
            const full = path.join(d, e.name);
            if (e.isDirectory()) visit(full, level + 1);
            else if (IMAGE_EXT.has(path.extname(e.name).toLowerCase())) out.push(full);
        }
    };
    visit(dir, 0);
    return out;
}

export function classifyDjiKind(fileName) {
    const base = path.basename(fileName, path.extname(fileName));
    if (/_T$/i.test(base)) return 'thermal';
    if (/_W$/i.test(base)) return 'wide';
    if (/_V$/i.test(base)) return 'visible';
    if (/_Z$/i.test(base)) return 'zoom';
    if (/_D$/i.test(base)) return 'dsm';
    return 'photo';
}

export async function readPhotoMeta(file) {
    let exif = null;
    try {
        exif = await exifr.parse(file, {
            pick: ['DateTimeOriginal', 'Make', 'Model', 'GPSLatitude', 'GPSLongitude', 'GPSAltitude', 'ExifImageWidth', 'ExifImageHeight', 'ImageWidth', 'ImageHeight'],
            gps: true, xmp: true, tiff: true, ifd0: true, exif: true,
        });
    } catch {
        exif = null;
    }
    const stat = fs.statSync(file);
    const lat = Number(exif?.latitude);
    const lon = Number(exif?.longitude);
    // DJI XMP: RelativeAltitude / GimbalYawDegree / FlightYawDegree
    const relAlt = Number(exif?.RelativeAltitude ?? exif?.['drone-dji:RelativeAltitude']);
    const yaw = Number(exif?.GimbalYawDegree ?? exif?.FlightYawDegree);
    return {
        id: createHash('md5').update(file).digest('hex').slice(0, 16),
        file,
        name: path.basename(file),
        kind: classifyDjiKind(file),
        lat: Number.isFinite(lat) ? lat : null,
        lon: Number.isFinite(lon) ? lon : null,
        altitude: Number.isFinite(Number(exif?.GPSAltitude)) ? Number(exif.GPSAltitude) : null,
        relativeAltitude: Number.isFinite(relAlt) ? relAlt : null,
        heading: Number.isFinite(yaw) ? yaw : null,
        takenAt: exif?.DateTimeOriginal ? new Date(exif.DateTimeOriginal).toISOString() : stat.mtime.toISOString(),
        camera: [exif?.Make, exif?.Model].filter(Boolean).join(' ') || null,
        width: exif?.ExifImageWidth || exif?.ImageWidth || null,
        height: exif?.ExifImageHeight || exif?.ImageHeight || null,
        size: stat.size,
    };
}

export async function makeThumb(file, outDir, id, width = 480) {
    fs.mkdirSync(outDir, { recursive: true });
    const out = path.join(outDir, `${id}.jpg`);
    if (fs.existsSync(out)) return out;
    try {
        const sharp = (await import('sharp')).default;
        await sharp(file).rotate().resize({ width, withoutEnlargement: true }).jpeg({ quality: 78 }).toFile(out);
        return out;
    } catch (err) {
        console.warn('[photos] thumbnail failed:', err.message);
        return null;
    }
}
