# PICT INDUSTRIAL — 산업단지 통합 관제 플랫폼

godseye(React + CesiumJS 3D 지구본 OSINT 대시보드)를 기반으로, **산업단지와 옥상 태양광을 위성·드론 데이터로 관리**하는 관제 플랫폼입니다.
원본 godseye(`D:\opencode\godseye`, 포트 5173)는 그대로 두고, 이 폴더(`D:\opencode\godseye-industrial`)에 별도 프로젝트로 구성했습니다.

## 실행

```bat
D:\opencode\godseye-industrial\start-industrial.bat
```

또는 수동으로:

```powershell
cd D:\opencode\godseye-industrial
npm run build       # 프런트엔드 빌드 (dist/) — 화면 코드를 바꿨을 때만
npm start           # API + 데이터 + 화면을 모두 3200 한 포트에서 서빙 (start-industrial.bat 과 동일)
```

- 접속: http://localhost:3200/ (같은 네트워크: http://10.0.10.22:3200/)
- 포트는 3200 하나만 사용합니다(2026-10-19 통합). 예전 5174 주소로 열린 탭은 서버가 자동으로 3200으로 넘겨줍니다(LEGACY_PORT, 끄려면 LEGACY_PORT=0). `npm run dev`(Vite 5174, 핫리로드)는 개발자가 화면 코드를 고칠 때만 선택적으로 쓰는 보조 도구이며 운영 경로가 아닙니다.
- 처음 실행 시 데모 데이터가 자동 생성됩니다. 설정 메뉴 → "데모 데이터 재생성"으로 초기화할 수 있습니다.

## 메뉴

| 메뉴 | 기능 |
|---|---|
| 대시보드 | 단지 요약, 실시간 PV 출력(SSE 5초), 오늘 예상 발전량, 핫스팟/알림 KPI, 어레이 건전성, 드론 상태 |
| 영상자료 | 위성·드론 정사영상·열화상·3D Tiles·사진 폴더 등록/업로드, GDAL 타일 생성(z12~21), 오버레이 on/off·투명도 |
| 열화상 분석 | 열화상 정사영상(GeoTIFF) 핫스팟 탐지(ΔT 기준, 어레이별 기준선), 등급(IEC TS 62446-3 참고), 목록→위치 이동, 현장 확인/조치 완료 |
| 태양광 관리 | 어레이 목록, 실시간 인버터 출력·모듈온도·효율, Open-Meteo 일사량 기반 오늘/내일 발전량·손실 추정, 세척/점검 작업지시 |
| 3D 트윈 | 실측 3D Tiles(iTwin/RealityScan/DJI Terra) 표시, 건물 블록 돌출·높이 배율, 시간대별 조명(그림자), 뷰 프리셋, 지형 과장 |
| 시설·입주기업 | 필지/건물/입주기업 검색·필터·편집, 위험도, PV 설치 잠재량 |
| 환경 모니터링 | 기상(일사·풍속·강수·드론 비행 가능 여부), 대기질(CAMS), 단지 센서(대기·소음·VOC·기상) 실시간 |
| 안전·재난 | 알림 센터(확인 처리), 위험 시설, 광역 레이어(산불 열점·지진·재난경보·항공기·공역), 수동 알림 발행 |
| 드론 운용 | 스테이션 상태(배터리·풍속), 임무 예약/완료, 촬영 원본 사진 EXIF GPS 인덱싱·썸네일·지도 표시 |
| 보고서 | 종합 점검 보고서 생성(권고 조치 자동), 인쇄/PDF, JSON 다운로드, 이력 |
| 설정 | 단지 추가/편집(좌표·면적·목표 kWp), 센서/스테이션 추가, GDAL·작업 상태, 외부 연동 안내 |

우측 상단 "피드" 버튼으로 godseye의 광역 레이어(항공기, 위성 궤도, 지진, 산불, 기상특보, 대기질 등)를 함께 켤 수 있습니다.

## 데이터 흐름

```
드론(DJI M4T 등) ─ 열화상/RGB 촬영 ─▶ DJI Terra / Pix4D / RealityScan ─▶ GeoTIFF(정사영상·열화상) / 3D Tiles
위성(Sentinel-2, Landsat, 국토위성) ─▶ GeoTIFF
          └──▶ 영상자료 메뉴에서 등록(서버 로컬 경로 또는 업로드)
                 ├─ GDAL: 메타(EPSG·경계·GSD) 추출 → WGS84 미리보기 PNG → XYZ 타일(z12~21)
                 ├─ 열화상: 온도 그리드(Float32) → 화면 컬러맵(ironbow/rainbow/white-hot) 오버레이
                 │          → 핫스팟 분석 → PV 어레이 매칭 → 건전성/알림/작업지시
                 └─ 3D Tiles: /3dtiles/<id>/… 로 스트리밍, 지면 높이 자동 보정
```

### 열화상 분석 규칙
- PV 어레이 내부: **어레이별 중앙값(정상 모듈 온도)** 대비 ΔT ≥ 임계값(기본 15 °C)
- PV 외부: 영상 중앙값 대비 ΔT ≥ 임계값 + 20 °C (지붕·도로 등 자연 고온면 제외, 열화상 메뉴에서 조정) · 최고온도 순 상위 300건 저장, 지도에는 200건 표시
- 등급: ΔT ≥ 30 심각 · ≥ 20 높음 · ≥ 10 보통 · 그 외 낮음
- 어레이 건전성 = 핫스팟 수·등급 가중 → 발전 추정 손실 계수 및 알림 자동 생성
- 입력: 온도값(Float32, °C) GeoTIFF 권장. 8/16비트 팔레트 영상은 데이터셋에 `scaleMin/scaleMax`를 지정하면 선형 환산

### 발전량 추정
P[kW] = 설비용량[kWp] × (GHI/1000) × PR(0.8) × (1 − 0.004 × (T모듈 − 25)) × 건전성계수, T모듈 = T외기 + (NOCT−20)/800 × GHI.
Open-Meteo 시간별 일사량 예보로 오늘/내일 kWh를 적분합니다.

## 3D Tiles 표시 규칙 (2026-10-19)
- 기본 SSE(maximumScreenSpaceError) 2, 거리 기반 품질 저하(dynamicScreenSpaceError)·skipLOD 끔, 비행 목적지 선로딩. 3D 트윈 메뉴의 "3D Tiles 상세도" 슬라이더(1~16)로 조절, 값은 브라우저에 저장.
- DJI Terra b3dm 타일셋은 중간 노드 geometricError가 1e10이라 원거리에서 최상위 4타일만 선택되는 문제가 있어, 노드 3000개 이하 소형 타일셋은 SSE를 슬라이더 값의 1/4(기본 0.5)로 자동 적용 → 3.5 km 상공에서도 바로 상세 메시가 보임.
- 열화상 재분석 규칙: 같은 단지·같은 촬영일의 방사율 변형 열화상(0.95/0.85/0.4/0.15)은 같은 비행이므로 분석 결과(핫스팟)를 하나만 유지한다(마지막 분석이 이전 결과를 교체). `DELETE /api/datasets/:id/hotspots` 로 특정 데이터셋 결과만 삭제할 수 있다.

## 현재 연결된 실제 데이터

### DJI Terra 실측 단지 (2026-10-19 추가)

| 단지 | 데이터 | 경로 (`E:\terra backup\PCGSPRO_1731413002\lalabas@naver.com\` 기준) |
|---|---|---|
| 동해산업단지 (site-donghae) | RGB 정사영상 2.6 cm + Terra 타일 z12~22 | `0916_동해산업단지\map\result.tif` |
| | 열화상 정사영상 11 cm Float32 °C (방사율 0.95/0.85/0.4/0.15) + 팔레트 타일 | `동해산업단지 열화상\map\infrared_map\result_Infrared_*.tif` |
| | 열화상 비행 RGB 7.5 cm · DSM 5 cm | `동해산업단지 열화상\map\result.tif` · `0916_동해산업단지\map\dsm.tif` |
| | 3D Tiles(b3dm) · 포인트클라우드(pnts) · LAS | `0916_동해산업단지\models\pc\0\terra_b3dms\tileset.json` · `terra_pnts\tileset.json` · `terra_las_1_4\*.las` |
| 원주 단계산업단지 (site-wonju) | **기본 RGB 7.4 cm + 타일 z12~20 (사용자 지정 경로, 열화상과 동일 비행)**, 열화상 11 cm, DSM · 보조: RGB 2.5 cm z12~22, b3dm, pnts | 기본: `원주단계산업단지_열화상\map\result.tif` · 열화상: `원주단계산업단지_열화상\map\infrared_map\…` · 보조: `0917_원주단계산업단지\…` |

- Terra의 `map\{z}\{x}\{y}.png` 타일(XYZ)은 재생성 없이 `/tiles/<id>/…` 로 직접 서빙합니다(데이터셋 `tilesDir`). 영상자료 메뉴에서 `result.tif` 경로만 등록해도 옆의 타일 폴더를 자동 연결합니다.
- 열화상은 기본 "Terra 팔레트 타일"(원해상도)로 표시하고, 열화상 메뉴에서 "온도 그리드 컬러맵"으로 전환할 수 있습니다.
- 대용량 GeoTIFF 분석은 GDAL로 3000 px 축소본(`data\analysis\`)을 캐시해 사용합니다.
- 실측 단지에는 가상 시설·PV가 없습니다. 태양광 메뉴 "지도에서 PV 어레이 그리기", 시설 메뉴 "지도에서 시설 그리기"로 정사영상 위에 폴리곤을 등록한 뒤 열화상을 재분석하면 어레이별 기준선이 적용됩니다.
- b3dm(3D Tiles)은 `tileset.json` 경로를 '3D Tiles' 유형으로 등록하면 되고, `pnts` 포인트클라우드는 '포인트클라우드' 유형으로 등록합니다. 같은 루트에 있는 다른 Terra 프로젝트(남춘천산업단지, 오송역 등)도 같은 방식으로 추가할 수 있습니다.

### 기존 데이터

| 데이터 | 경로 | 비고 |
|---|---|---|
| 춘천 실측 3D Tiles (iTwin, 2024-11) | `D:\20T_01\itwin\20241112\Productions\chuncheon_03_cesium\Scene\chuncheon_03_cesium.json` | 춘천 3D 실증구역에 연결 |
| 춘천 3D Tiles 구역 2 | `…\Production_1_cesium\Scene\Production_1_cesium.json` | 기본 OFF |
| 강촌 RGB 정사영상 (2026-08-15) | `C:\Users\sunny\Downloads\-2026-8-15-orthophoto.tif` | UTM 52N, 18490×14944, 타일 z12~21 생성 완료 |
| 강촌 VARI 식생지수 | `C:\Users\sunny\Downloads\-2026-8-15-orthophoto-VARI.tif` | 미리보기 오버레이 |
| 열화상 촬영 원본 (DJI, 2026-07-30) | `C:\Users\sunny\Downloads\ir` (1,078장) | 드론 운용 → 사진 → 인덱싱 실행 시 지도 표시 |
| 북평 열화상 정사영상 | `data\synthetic\site-bukpyeong-thermal.tif` | **합성 데모**. 실제 열화상 매핑 결과로 교체 권장 |

## 서버 구조

```
server/
  index.js            Express(ESM) · 정적(/tiles, /previews, /thumbs, /3dtiles) · SSE(/events) · 시드
  seed.js             데모 단지 3곳(북평·춘천·강촌) 시설/PV/센서/스테이션/임무/합성 열화상
  lib/store.js        JSON 파일 DB (data/db.json)
  lib/gdal.js         QGIS 번들 GDAL 탐색/실행 (gdalinfo, gdal_translate, gdalwarp, gdal raster tile)
  lib/raster.js       GeoTIFF/ASC 읽기(geotiff.js) · EPSG→WGS84(proj4; UTM, 5179/5186 등)
  lib/thermal.js      핫스팟 탐지(연결 성분) · 어레이별 기준선 · 등급
  lib/pv.js           발전량 추정 · 어레이 건전성
  lib/sim.js          텔레메트리 시뮬레이터(인버터·센서·도크) + SSE 브로드캐스트
  lib/photos.js       EXIF GPS 인덱싱(exifr) · 썸네일(sharp)
  lib/datasets.js     데이터셋 처리 파이프라인(메타→미리보기→타일) · 작업 큐
  routes/core.js      sites/facilities/panelArrays/sensors/docks/missions/workOrders/alerts CRUD · summary
  routes/datasets.js  데이터셋 등록/업로드/처리 · 열화상 그리드/분석 · 사진 인덱스 · 작업 상태
  routes/external.js  기상/대기질 프록시 · PV 예측 · 보고서
```

주요 API: `GET /api/sites/:id/summary`, `POST /api/datasets/register`, `POST /api/datasets/:id/analyze-thermal`, `GET /api/datasets/:id/thermal-grid`, `GET /api/sites/:id/pv-forecast`, `GET /api/sites/:id/report`, `GET /events`(SSE).

## 환경 변수 (.env.local / 서버 환경)
- `PORT` (기본 3200), `INDUSTRIAL_DATA_DIR` (기본 `./data`), `GDAL_BIN` (QGIS 자동 탐색 실패 시), `TELEMETRY_INTERVAL_MS`
- `VITE_CESIUM_ION_TOKEN` 을 넣으면 godseye 기본 설정대로 Cesium ion 자산을 쓸 수 있습니다(현재는 Esri 위성영상 + 타원체 지형).

## 실제 연동으로 바꿀 때
- **열화상 원본(DJI R-JPEG)** 의 온도값 추출은 DJI Thermal SDK(dji_irp)가 필요합니다. DJI Terra 열화상 매핑으로 Float32 GeoTIFF를 만들면 바로 분석됩니다.
- **인버터/센서**: `server/lib/sim.js` 의 `telemetry` 이벤트 형식에 맞춰 Modbus/MQTT 수신 결과를 `broadcast('telemetry', …)` 하면 화면 수정 없이 교체됩니다.
- **DJI Dock/FlightHub 2**: 임무 예약·사진 자동 수집은 `routes/core.js` missions 와 `lib/photos.js` 를 FH2 API로 연결합니다(마라톤 플랫폼의 inbox 감시 방식 재사용 가능).

## 화면 캡처 / 점검 스크립트
`node tools/screenshot.mjs http://localhost:3200/ out.png` — 설치된 Chrome(headless)으로 접속해 콘솔 오류를 출력하고 캡처합니다.
`STEPS='eval:window.__gi.getState().setMenu("thermal")|wait:3000|shot:a.png'` 형식으로 메뉴 전환·캡처를 이어서 실행할 수 있습니다.
캡처 예시는 `docs/screenshots/` 에 있습니다.
