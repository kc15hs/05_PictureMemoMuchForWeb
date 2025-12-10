// js/app.js
// 05_PictureMemoMuchForWeb 用フロントロジック
// 移植元 05_PictureMemoMuch_251208.py と同一ロジック（Exif→Memo / Memo→Exif 両方）
//
// 想定HTML側ID：
//  #exifFile        : Exif CSV ファイル input(type="file")
//  #memoFile        : メモTXT ファイル input(type="file")
//  #distInput       : 距離しきい値(m) input(text)
//  #timeInput       : 時間しきい値(秒) input(text)
//  #ignoreDistance  : 距離を無視 checkbox
//  #ignoreTime      : 時間を無視 checkbox
//  name="matchMode" : AND/OR ラジオボタン (value="AND" or "OR")
//  #startDate       : 開始日 input(type="date")
//  #startHour       : 開始時 input(text or select, "00"〜"23")
//  #startMin        : 開始分 input(text or select, "00"〜"59")
//  #endDate         : 終了日 input(type="date")
//  #endHour         : 終了時
//  #endMin          : 終了分
//  #runButton       : 実行ボタン
//  #status          : 処理状況表示用 <div>
//  #downloadLink    : 出力CSVダウンロードリンク <a>

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
  // ファイル読み込み（Promise で text を返す）
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
    // シンプルな CSV パーサ（カンマ区切り・ダブルクォート対応）
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
            // エスケープされたダブルクォート
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
      const cols = header.map((h) => row[h] !== undefined ? String(row[h]) : "");
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
  // 日付/時刻処理
  // ============================================================
  function parseDateTime(str) {
    // "YYYY-MM-DD HH:MM:SS"
    if (!str) return null;
    // Safari 等も考慮して手動パース
    const m = str.match(
      /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/
    );
    if (!m) return null;
    const y = parseInt(m[1], 10);
    const M = parseInt(m[2], 10) - 1;
    const d = parseInt(m[3], 10);
    const hh = parseInt(m[4], 10);
    const mm = parseInt(m[5], 10);
    const ss = m[6] ? parseInt(m[6], 10) : 0;
    return new Date(y, M, d, hh, mm, ss);
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
  // 距離計算（ハーバサイン）
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

  // GPS 妥当性チェック
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

  // 緯度・経度を小数第?位で丸めたい場合に使うならここだが、
  // 本ツールでは入力 CSV の値をそのまま使う（Python 版と同じ前提）。

  // ============================================================
  // メモTXT 読み込み (load_memo_txt と同等)
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
        const timeStr = line.substring(0, idx);
        const rest = line.substring(idx + 3);

        const dt = parseDateTime(timeStr);
        if (!dt) continue;

        const latPos = rest.lastIndexOf("(lat:");
        if (latPos === -1) continue;

        const textPart = rest.substring(0, latPos).trim();
        const coordPart = rest.substring(latPos).trim();

        let coordInner;
        if (coordPart.startsWith("(") && coordPart.endsWith(")")) {
          coordInner = coordPart.substring(1, coordPart.length - 1);
        } else {
          coordInner = coordPart;
        }

        let latVal = null;
        let lngVal = null;

        const pieces = coordInner.split(",");
        for (let piece of pieces) {
          piece = piece.trim();
          if (piece.startsWith("lat:")) {
            const v = piece.substring(4).trim();
            if (v && v.toLowerCase() !== "null") {
              latVal = parseFloat(v);
            }
          } else if (piece.startsWith("lng:")) {
            const v = piece.substring(4).trim();
            if (v && v.toLowerCase() !== "null") {
              lngVal = parseFloat(v);
            }
          }
        }

        if (latVal == null || lngVal == null || isNaN(latVal) || isNaN(lngVal))
          continue;

        entries.push({
          time: dt,
          lat: latVal,
          lng: lngVal,
          text: textPart,
        });
      } catch (e) {
        // 1行失敗は無視
      }
    }
    return entries;
  }

  // ============================================================
  // メイン照合ロジック（match_and_fill と同等）
  // ============================================================
  function matchAndFillJs(
    exifHeader,
    exifRows,
    memoEntries,
    distThresholdM,
    timeThresholdSec,
    ignoreDistance,
    ignoreTime,
    matchMode, // "AND" or "OR"
    startDt,
    endDt
  ) {
    // 必須列確認
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

    const exifRowCount = exifRows.length;
    if (exifRowCount === 0) {
      throw new Error("Exif CSV にデータがありません。");
    }

    if (!memoEntries || memoEntries.length === 0) {
      throw new Error("メモTXTに有効なデータがありません。");
    }

    // Exif DayTime を Date 化
    const exifTimes = exifRows.map((row) => parseDateTime(row["DayTime"]));
    let matchedExifCount = 0;
    let memoMatchedCount = 0;

    let exifSeq = 1;
    let memoSeq = 1;

    // ==========================================================
    // 1) Exif → Memo
    // ==========================================================
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
          curMseq += 1;
          continue;
        }

        // ---- 時間判定 ----
        let timeOk = true;
        if (!ignoreTime) {
          const deltaSec = Math.abs(
            (exifTime.getTime() - memoTime.getTime()) / 1000
          );
          timeOk = deltaSec <= timeThresholdSec;
        }

        // ---- 距離判定 ----
        let distanceChecked = false;
        let distanceOk = false;

        if (!ignoreDistance) {
          if (gpsExif && gpsValid(memo.lat, memo.lng)) {
            const dist = haversine(
              parseFloat(exifLat),
              parseFloat(exifLng),
              memo.lat,
              memo.lng
            );
            distanceOk = dist <= distThresholdM;
            distanceChecked = true;
          } else {
            // GPS欠損 → 距離評価不可
            distanceOk = false;
            distanceChecked = false;
          }
        } else {
          // 距離無視
          distanceOk = false;
          distanceChecked = false;
        }

        // ---- AND / OR ----
        let isMatch;
        if (matchMode === "AND") {
          if (distanceChecked) {
            isMatch = distanceOk && timeOk;
          } else {
            // 距離評価できない場合は時間のみ
            isMatch = timeOk;
          }
        } else {
          // "OR"
          if (distanceChecked) {
            isMatch = distanceOk || timeOk;
          } else {
            isMatch = timeOk;
          }
        }

        if (!isMatch) {
          curMseq += 1;
          continue;
        }

        matchedTexts.push(memo.text);
        matchedMemoSeq.push(curMseq.toString().padStart(3, "0"));
        curMseq += 1;
      }

      // flg
      const flg = matchedTexts.length > 0 ? "1" : "0";

      // FileName = 実ファイル名 + "-" + FLG（拡張子は残す）
      const origFname = row["FileName"];
      row["FileName"] = `${origFname}-${flg}`;

      exifSeq++;

      // Memo 本文へ (SEQ) を付ける
      if (matchedTexts.length > 0) {
        const seqPart = matchedMemoSeq.join("/");

        const bodyList = [];
        for (let k = 0; k < matchedTexts.length; k++) {
          const s = matchedMemoSeq[k];
          const t = matchedTexts[k];
          bodyList.push(`(${s})${t}`);
        }
        const bodyPart = bodyList.join(" / ");

        row["Memo"] = `【${seqPart}】${bodyPart}`;
        matchedExifCount += 1;
      } else {
        row["Memo"] = "";
      }
    }

    // ==========================================================
    // 2) Memo → Exif（メモ行生成）
    // ==========================================================
    const memoRows = [];

    for (const memo of memoEntries) {
      const memoTime = memo.time;
      if (memoTime < startDt || memoTime > endDt) {
        memoSeq += 1;
        continue;
      }

      const matchedExifNames = [];
      let flg = "0";

      for (let i = 0; i < exifRows.length; i++) {
        const row = exifRows[i];
        const exifTime = exifTimes[i];
        if (!exifTime) continue;
        if (exifTime < startDt || exifTime > endDt) continue;

        // ---- 時間 ----
        let timeOk = true;
        if (!ignoreTime) {
          const deltaSec = Math.abs(
            (exifTime.getTime() - memoTime.getTime()) / 1000
          );
          timeOk = deltaSec <= timeThresholdSec;
        }

        // ---- 距離 ----
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
            distanceOk = false;
            distanceChecked = false;
          }
        } else {
          distanceOk = false;
          distanceChecked = false;
        }

        // ---- AND / OR ----
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

      if (flg === "1") {
        memoMatchedCount += 1;
      }

      const newFname = `m${memoSeq.toString().padStart(3, "0")}-${flg}`;
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

      memoSeq += 1;
    }

    // ==========================================================
    // 結合 → DayTime でソート
    // ==========================================================
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
      exifRowCount,
      totalMemo: memoEntries.length,
      memoMatchedCount,
    };
  }

  // ============================================================
  // メイン実行ハンドラ
  // ============================================================
  async function onRun() {
    try {
      showStatus("ファイル読み込み中...");

      const exifFileInput = $("exifFile");
      const memoFileInput = $("memoFile");
      if (!exifFileInput || !memoFileInput) {
        alert("exifFile/memoFile の input が見つかりません。HTML側IDを確認してください。");
        return;
      }

      const exifFile = exifFileInput.files[0];
      const memoFile = memoFileInput.files[0];
      if (!exifFile) {
        alert("Exif CSV ファイルを選択してください。");
        return;
      }
      if (!memoFile) {
        alert("メモTXT ファイルを選択してください。");
        return;
      }

      const [exifText, memoText] = await Promise.all([
        readFileAsText(exifFile),
        readFileAsText(memoFile),
      ]);

      const exifCsv = parseCsv(exifText);
      const memoEntries = parseMemoTxt(memoText);

      // パラメータ取得
      const distStr = $("distInput").value.trim();
      const timeStr = $("timeInput").value.trim();

      const distThresholdM = parseFloat(distStr);
      const timeThresholdSec = parseFloat(timeStr);
      if (isNaN(distThresholdM) || isNaN(timeThresholdSec)) {
        alert("距離・時間は数値で入力してください。");
        return;
      }

      const ignoreDistance = $("ignoreDistance").checked;
      const ignoreTime = $("ignoreTime").checked;

      const matchModeInput = document.querySelector('input[name="matchMode"]:checked');
      const matchMode = matchModeInput ? matchModeInput.value : "OR";

      // 期間
      const sdStr = $("startDate").value; // "YYYY-MM-DD"
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
        alert("開始日時は終了より前にしてください。");
        return;
      }

      showStatus("マッチング処理中...");

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

      // 出力ファイル名生成（元の Exif CSV 名ベース）
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
          ? `${DD.toString().padStart(2, "0")}and${TT
              .toString()
              .padStart(2, "0")}`
          : `${DD.toString().padStart(2, "0")}or${TT
              .toString()
              .padStart(2, "0")}`;

      const outName = `${baseName}_${sStr}_${eStr}_${ddtt}.csv`;

      const csvText = toCsv(result.header, result.rows);
      const bom = "\uFEFF";
      const blob = new Blob([bom + csvText], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);

      const a = $("downloadLink");
      if (a) {
        a.href = url;
        a.download = outName;
        a.style.display = "inline-block";
        a.textContent = `CSV をダウンロード (${outName})`;
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
  // イベント登録
  // ============================================================
  window.addEventListener("DOMContentLoaded", () => {
    const btn = $("runButton");
    if (btn) {
      btn.addEventListener("click", (e) => {
        e.preventDefault();
        onRun();
      });
    }
  });
})();
