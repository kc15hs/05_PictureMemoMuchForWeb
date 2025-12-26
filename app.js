// js/app.js
// 05_PictureMemoMuchForWeb 用フロントロジック
// 移植元 05_PictureMemoMuch_251208.py と同一ロジック（Exif→Memo / Memo→Exif 両方）
//
// HTML側ID：
//  #exifFile, #memoFile
//  #distInput, #timeInput
//  #ignoreDistance, #ignoreTime
//  name="matchMode"
//  #startDate, #startHour, #startMin
//  #endDate, #endHour, #endMin
//  #runButton, #status, #downloadLink

(function () {

  // ============================================================
  // 汎用：DOM ヘルパ
  // ============================================================
  function $(id) {
    return document.getElementById(id);
  }

  function showStatus(msg) {
    const el = $("status");
    if (el) el.textContent = msg;
  }

  // ============================================================
  // ファイル読み込み
  // ============================================================
  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => resolve(e.target.result);
      reader.onerror = (e) => reject(e);
      reader.readAsText(file, "UTF-8");
    });
  }

  // ============================================================
  // CSV パース / 文字列化
  // ============================================================
  function parseCsv(text) {
    const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    if (lines.length === 0) return { header: [], rows: [] };

    const header = parseCsvLine(lines[0]);
    const rows = [];

    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;

      const cols = parseCsvLine(line);
      const row = {};

      for (let j = 0; j < header.length; j++) {
        row[header[j]] = cols[j] !== undefined ? cols[j] : "";
      }
      rows.push(row);
    }

    return { header, rows };
  }

  function parseCsvLine(line) {
    const result = [];
    let cur = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];

      if (inQuotes) {
        if (ch === '"') {
          if (i + 1 < line.length && line[i + 1] === '"') {
            cur += '"';
            i++;
          } else {
            inQuotes = false;
          }
        } else {
          cur += ch;
        }
      } else {
        if (ch === '"') {
          inQuotes = true;
        } else if (ch === ",") {
          result.push(cur);
          cur = "";
        } else {
          cur += ch;
        }
      }
    }

    result.push(cur);
    return result;
  }

  function toCsv(header, rows) {
    const lines = [];
    lines.push(csvLine(header));

    for (const row of rows) {
      const cols = header.map(h => row[h] !== undefined ? String(row[h]) : "");
      lines.push(csvLine(cols));
    }

    return lines.join("\r\n");
  }

  function csvLine(cols) {
    return cols
      .map((v) => {
        const s = String(v ?? "");
        if (/[",\r\n]/.test(s)) {
          return `"${s.replace(/"/g, '""')}"`;
        }
        return s;
      })
      .join(",");
  }

  // ============================================================
  // 日付/時刻処理（※完全修正版）
  // ============================================================
  function parseDateTime(str) {
    if (!str) return null;

    str = str
      .replace(/\u3000/g, " ")
      .replace(/\s+/g, " ")
      .trim();

    const m = str.match(
      /^(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?$/
    );
    if (!m) return null;

    const y = parseInt(m[1], 10);
    const M = parseInt(m[2], 10) - 1;
    const d = parseInt(m[3], 10);
    const hh = parseInt(m[4], 10);
    const mm = parseInt(m[5], 10);
    const ss = m[6] ? parseInt(m[6], 10) : 0;

    const dt = new Date(y, M, d, hh, mm, ss);

    if (isNaN(dt.getTime())) return null;

    return dt;
  }

  function formatDateTime(dt) {
    if (!dt) return "";
    const pad2 = (n) => (n < 10 ? "0" + n : "" + n);

    return (
      dt.getFullYear() +
      "-" +
      pad2(dt.getMonth() + 1) +
      "-" +
      pad2(dt.getDate()) +
      " " +
      pad2(dt.getHours()) +
      ":" +
      pad2(dt.getMinutes()) +
      ":" +
      pad2(dt.getSeconds())
    );
  }

  // ============================================================
  // 距離計算
  // ============================================================
  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6378137;
    const toRad = (x) => (x * Math.PI) / 180;

    lat1 = toRad(lat1);
    lon1 = toRad(lon1);
    lat2 = toRad(lat2);
    lon2 = toRad(lon2);

    const dlat = lat2 - lat1;
    const dlon = lon2 - lon1;

    const a =
      Math.sin(dlat / 2) ** 2 +
      Math.cos(lat1) * Math.cos(lat2) * Math.sin(dlon / 2) ** 2;

    return R * 2 * Math.asin(Math.sqrt(a));
  }

  function gpsValid(lat, lng) {
    try {
      lat = parseFloat(lat);
      lng = parseFloat(lng);
    } catch (e) {
      return false;
    }
    if (isNaN(lat) || isNaN(lng)) return false;
    if (lat === 0.0 && lng === 0.0) return false;
    if (!(lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180)) return false;
    return true;
  }

  // ============================================================
  // メモTXT 読み込み（※ 複数ファイル＋MMDD付与に拡張）
  // ============================================================
  function parseMemoTxt(text) {
    const lines = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
    const entries = [];

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      try {
        const idx = line.indexOf(" - ");
        if (idx === -1) continue;

        const timeStr = line.substring(0, idx).trim();
        const rest = line.substring(idx + 3).trim();

        const dt = parseDateTime(timeStr);
        if (!dt) continue;

        const latPos = rest.lastIndexOf("(lat:");
        if (latPos === -1) continue;

        const textPart = rest.substring(0, latPos).trim();
        const coordPart = rest.substring(latPos).trim();

        let coordInner = coordPart;
        if (coordPart.startsWith("(") && coordPart.endsWith(")")) {
          coordInner = coordPart.substring(1, coordPart.length - 1);
        }

        let latVal = null;
        let lngVal = null;

        const pieces = coordInner.split(",");
        for (let piece of pieces) {
          piece = piece.trim();
          if (piece.startsWith("lat:")) {
            const v = piece.substring(4).trim();
            if (v && v.toLowerCase() !== "null") latVal = parseFloat(v);
          } else if (piece.startsWith("lng:")) {
            const v = piece.substring(4).trim();
            if (v && v.toLowerCase() !== "null") lngVal = parseFloat(v);
          }
        }

        if (latVal == null || lngVal == null || isNaN(latVal) || isNaN(lngVal))
          continue;

        entries.push({
          time: dt,
          lat: latVal,
          lng: lngVal,
          text: textPart,
          MMDD: null   // ★後で付与
        });
      } catch (e) {
        // 無視
      }
    }

    return entries;
  }

  // ============================================================
  // マッチング処理（前半）
  // ============================================================
  function matchAndFillJs(
    exifHeader,
    exifRows,
    memoEntries,
    distThresholdM,
    timeThresholdSec,
    ignoreDistance,
    ignoreTime,
    matchMode,
    startDt,
    endDt
  ) {
    const requiredCols = [
      "FileName",
      "DayTime",
      "Latitude",
      "Longitude",
      "URL",
      "LocalURL",
      "Memo",
    ];

    for (const c of requiredCols) {
      if (!exifHeader.includes(c)) {
        throw new Error(`Exif CSV に列 '${c}' がありません。`);
      }
    }

    if (exifRows.length === 0) {
      throw new Error("Exif CSV にデータがありません。");
    }

    if (!memoEntries || memoEntries.length === 0) {
      throw new Error("メモTXTに有効なデータがありません。");
    }

    const exifTimes = exifRows.map((row) => parseDateTime(row["DayTime"]));
    let matchedExifCount = 0;
    let memoMatchedCount = 0;

    let exifSeq = 1;
    let memoSeq = 1;

    // ------------ Exif → Memo ここから ------------
    for (let i = 0; i < exifRows.length; i++) {
      const row = exifRows[i];
      const exifTime = exifTimes[i];
      if (!exifTime) continue;
      if (exifTime < startDt || exifTime > endDt) continue;

      const exifLat = row["Latitude"];
      const exifLng = row["Longitude"];
      const gpsExif = gpsValid(exifLat, exifLng);

      const matchedTexts = [];
      const matchedMemoSeq = [];

      let curMseq = 1;

      for (const memo of memoEntries) {
        const memoTime = memo.time;

        if (memoTime < startDt || memoTime > endDt) {
          curMseq++;
          continue;
        }

        let timeOk = true;
        if (!ignoreTime) {
          const ex = exifTime.getTime();
          const me = memoTime.getTime();

          if (isNaN(ex) || isNaN(me)) {
            timeOk = false;
          } else {
            const deltaSec = Math.abs((ex - me) / 1000);
            timeOk = deltaSec <= timeThresholdSec;
          }
        }

        let distanceChecked = false;
        let distanceOk = false;

        if (!ignoreDistance) {
          if (gpsValid(exifLat, exifLng) && gpsValid(memo.lat, memo.lng)) {
            const dist = haversine(
              parseFloat(exifLat),
              parseFloat(exifLng),
              memo.lat,
              memo.lng
            );
            distanceOk = dist <= distThresholdM;
            distanceChecked = true;
          } else {
            distanceChecked = false;
            distanceOk = false;
          }
        }

        let isMatch;
        if (matchMode === "AND") {
          if (distanceChecked) {
            isMatch = distanceOk && timeOk;
          } else {
            isMatch = timeOk;
          }
        } else {
          if (distanceChecked) {
            isMatch = distanceOk || timeOk;
          } else {
            isMatch = timeOk;
          }
        }

        if (!isMatch) {
          curMseq++;
          continue;
        }

        matchedTexts.push(memo.text);
        matchedMemoSeq.push(curMseq.toString().padStart(3, "0"));

        curMseq++;
      }

      const flg = matchedTexts.length > 0 ? "1" : "0";

      const origFname = row["FileName"];
      row["FileName"] = `${origFname}-${flg}`;

      exifSeq++;

      if (matchedTexts.length > 0) {
        const seqPart = matchedMemoSeq.join("/");

        const bodyList = [];
        for (let k = 0; k < matchedTexts.length; k++) {
          bodyList.push(`(${matchedMemoSeq[k]})${matchedTexts[k]}`);
        }
        const bodyPart = bodyList.join(" / ");

        row["Memo"] = `【${seqPart}】${bodyPart}`;
        matchedExifCount++;
      } else {
        row["Memo"] = "";
      }
    }

    // ------------ Memo → Exif ここから ------------
    const memoRows = [];

    for (const memo of memoEntries) {
      const memoTime = memo.time;
      if (memoTime < startDt || memoTime > endDt) {
        memoSeq++;
        continue;
      }

      let matchedExifNames = [];
      let flg = "0";

      for (let i = 0; i < exifRows.length; i++) {
        const row = exifRows[i];
        const exifTime = exifTimes[i];

        if (!exifTime) continue;
        if (exifTime < startDt || exifTime > endDt) continue;

        let timeOk = true;
        if (!ignoreTime) {
          const ex = exifTime.getTime();
          const me = memoTime.getTime();
          if (isNaN(ex) || isNaN(me)) {
            timeOk = false;
          } else {
            const deltaSec = Math.abs((ex - me) / 1000);
            timeOk = deltaSec <= timeThresholdSec;
          }
        }

        const exifLat = row["Latitude"];
        const exifLng = row["Longitude"];

        let distanceChecked = false;
        let distanceOk = false;

        if (!ignoreDistance) {
          if (gpsValid(exifLat, exifLng) && gpsValid(memo.lat, memo.lng)) {
            const dist = haversine(
              parseFloat(exifLat),
              parseFloat(exifLng),
              memo.lat,
              memo.lng
            );
            distanceOk = dist <= distThresholdM;
            distanceChecked = true;
          } else {
            distanceChecked = false;
            distanceOk = false;
          }
        }

        let isMatch;
        if (matchMode === "AND") {
          if (distanceChecked) {
            isMatch = distanceOk && timeOk;
          } else {
            isMatch = timeOk;
          }
        } else {
          if (distanceChecked) {
            isMatch = distanceOk || timeOk;
          } else {
            isMatch = timeOk;
          }
        }

        if (!isMatch) continue;

        flg = "1";

        let fname = row["FileName"] || "";
        if (fname.endsWith("-0") || fname.endsWith("-1")) {
          fname = fname.slice(0, -2);
        }
        const dotPos = fname.lastIndexOf(".");
        const fnameNoext = dotPos >= 0 ? fname.slice(0, dotPos) : fname;

        matchedExifNames.push(fnameNoext);
      }

      if (flg === "1") memoMatchedCount++;

      // ★ 新ルール: M + MMDD + "_" + Seq(3桁) + "-" + Flag
      const MMDD = memo.MMDD || "0000";
      const newFname = `M${MMDD}_${memoSeq.toString().padStart(3, "0")}-${flg}`;

      const exifPart = matchedExifNames.join("/");
      const memoCol = `【${exifPart}】${memo.text}`;

      memoRows.push({
        FileName: newFname,
        DayTime: formatDateTime(memoTime),
        Latitude: memo.lat,
        Longitude: memo.lng,
        URL: `https://www.google.com/maps/search/?api=1&query=${memo.lat},${memo.lng}`,
        LocalURL: "",
        Memo: memoCol,
      });

      memoSeq++;
    }

    const allRows = exifRows.concat(memoRows);

    allRows.sort((a, b) => {
      const da = parseDateTime(a["DayTime"]);
      const db = parseDateTime(b["DayTime"]);
      if (!da && !db) return 0;
      if (!da) return 1;
      if (!db) return -1;
      return da - db;
    });

    return {
      header: requiredCols,
      rows: allRows,
      matchedExifCount,
      exifRowCount: exifRows.length,
      totalMemo: memoEntries.length,
      memoMatchedCount,
    };
  }

  // ============================================================
  // ボタンクリック → 実行 onRun()
  // ============================================================
  async function onRun() {
    try {
      showStatus("ファイル読み込み中...");

      const exifFileInput = $("exifFile");
      const memoFileInput = $("memoFile");

      if (!exifFileInput || !memoFileInput) {
        alert("exifFile / memoFile の input が見つかりません。");
        return;
      }

      const exifFile = exifFileInput.files[0];
      const memoFiles = memoFileInput.files;

      if (!exifFile) {
        alert("Exif CSV ファイルを選択してください。");
        return;
      }
      if (!memoFiles || memoFiles.length === 0) {
        alert("メモTXT ファイルを選択してください。");
        return;
      }

      // Exif 読み込み
      const exifText = await readFileAsText(exifFile);
      const exifCsv = parseCsv(exifText);

      // メモ複数読み込み
      let memoEntries = [];

      for (const f of memoFiles) {
        const txt = await readFileAsText(f);
        const entries = parseMemoTxt(txt);

        // ファイル名から MMDD を付与
        const fname = f.name;
        const year = fname.substring(0, 4);
        const idx = fname.indexOf("_");
        let MMDD = null;

        if (idx !== -1) {
          const tail = fname.substring(idx + 1);
          const m = tail.match(/(\d{1,2})月(\d{1,2})日/);
          if (m) {
            const MM = m[1].padStart(2, "0");
            const DD = m[2].padStart(2, "0");
            MMDD = MM + DD;
          }
        }

        for (const e of entries) {
          e.MMDD = MMDD;
        }

        memoEntries = memoEntries.concat(entries);
      }

      const distThresholdM = parseFloat($("distInput").value.trim());
      const timeThresholdSec = parseFloat($("timeInput").value.trim());

      if (isNaN(distThresholdM) || isNaN(timeThresholdSec)) {
        alert("距離・時間は数値で入力してください。");
        return;
      }

      const ignoreDistance = $("ignoreDistance").checked;
      const ignoreTime = $("ignoreTime").checked;

      const matchModeInput = document.querySelector('input[name="matchMode"]:checked');
      const matchMode = matchModeInput ? matchModeInput.value : "OR";

      const sdStr = $("startDate").value;
      const edStr = $("endDate").value;
      const shStr = $("startHour").value || "00";
      const smStr = $("startMin").value || "00";
      const ehStr = $("endHour").value || "23";
      const emStr = $("endMin").value || "59";

      if (!sdStr || !edStr) {
        alert("開始日・終了日を指定してください。");
        return;
      }

      const startDt = parseDateTime(`${sdStr} ${shStr}:${smStr}:00`);
      const endDt = parseDateTime(`${edStr} ${ehStr}:${emStr}:59`);

      if (!startDt || !endDt) {
        alert("期間指定が正しくありません。");
        return;
      }
      if (startDt > endDt) {
        alert("開始日時が終了より後です。");
        return;
      }

      showStatus("マッチング中...");

      const result = matchAndFillJs(
        exifCsv.header,
        exifCsv.rows,
        memoEntries,
        distThresholdM,
        timeThresholdSec,
        ignoreDistance,
        ignoreTime,
        matchMode,
        startDt,
        endDt
      );

      const baseName = (exifFile.name || "exif_export").replace(/\.csv$/i, "");
      const pad2 = (n) => (n < 10 ? "0" + n : "" + n);

      const sStr =
        String(startDt.getFullYear()).slice(2) +
        pad2(startDt.getMonth() + 1) +
        pad2(startDt.getDate()) +
        pad2(startDt.getHours()) +
        pad2(startDt.getMinutes());

      const eStr =
        String(endDt.getFullYear()).slice(2) +
        pad2(endDt.getMonth() + 1) +
        pad2(endDt.getDate()) +
        pad2(endDt.getHours()) +
        pad2(endDt.getMinutes());

      const DD = Math.round(distThresholdM);
      const TT = Math.round(timeThresholdSec);

      const ddtt =
        matchMode === "AND"
          ? `${DD.toString().padStart(2, "0")}and${TT.toString().padStart(2, "0")}`
          : `${DD.toString().padStart(2, "0")}or${TT.toString().padStart(2, "0")}`;

      // ===== ZIP出力（3CSV） =====
      const prefix = "PhotoMemoMuch";

      const zipName = `${prefix}_${sStr}_${eStr}_${ddtt}.zip`;
      const bom = "\uFEFF";

      const csvAll   = toCsv(result.header, result.rows);
      const csvPhoto = toCsv(result.header, exifCsv.rows);
      const csvMemo  = toCsv(result.header, result.rows.filter(r => String(r.FileName || "").startsWith("M")));

      const zip = new JSZip();
      zip.file(`${prefix}_${sStr}_${eStr}_${ddtt}.csv`,        bom + csvAll);
      zip.file(`${prefix}_${sStr}_${eStr}_${ddtt}_photo.csv`,  bom + csvPhoto);
      zip.file(`${prefix}_${sStr}_${eStr}_${ddtt}_memo.csv`,   bom + csvMemo);

      const zipBlob = await zip.generateAsync({ type: "blob" });
      const url = URL.createObjectURL(zipBlob);

      const a = $("downloadLink");
      if (a) {
        a.href = url;
        a.download = zipName;
        a.style.display = "inline-block";
        a.textContent = `ZIP をダウンロード (${zipName})`;
      }

      showStatus(
        `処理完了: Exif件数=${result.exifRowCount}, メモ件数=${result.totalMemo}, ` +
          `Exifマッチ件数=${result.matchedExifCount}, メモマッチ件数=${result.memoMatchedCount}`
      );
    } catch (e) {
      console.error(e);
      alert("処理中にエラーが発生しました: " + e.message);
      showStatus("エラーが発生しました。コンソールを確認してください。");
    }
  }

  // ============================================================
  // イベント登録（メモTXT選択 → 日付自動セット）
  // ============================================================
  window.addEventListener("DOMContentLoaded", () => {

    const memoInput = $("memoFile");
    if (memoInput) {
      memoInput.addEventListener("change", () => {
        const files = memoInput.files;
        if (!files || files.length === 0) return;

        let dates = [];

        for (const f of files) {
          const fname = f.name;
          const year = fname.substring(0, 4);
          const idx = fname.indexOf("_");
          if (idx === -1) continue;

          const tail = fname.substring(idx + 1);
          const m = tail.match(/(\d{1,2})月(\d{1,2})日/);
          if (!m) continue;

          const MM = m[1].padStart(2, "0");
          const DD = m[2].padStart(2, "0");
          const dateStr = `${year}-${MM}-${DD}`;

          dates.push(new Date(dateStr));
        }

        if (dates.length === 0) return;

        const minDate = new Date(Math.min(...dates));
        const maxDate = new Date(Math.max(...dates));

        const pad2 = (n) => (n < 10 ? "0" + n : "" + n);

        $("startDate").value = `${minDate.getFullYear()}-${pad2(minDate.getMonth() + 1)}-${pad2(minDate.getDate())}`;
        $("endDate").value = `${maxDate.getFullYear()}-${pad2(maxDate.getMonth() + 1)}-${pad2(maxDate.getDate())}`;

        $("startHour").value = "00";
        $("startMin").value = "00";
        $("endHour").value = "23";
        $("endMin").value = "59";
      });
    }

    const btn = $("runButton");
    if (btn) {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        onRun();
      });
    }
  });

})();
