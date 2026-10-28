/**
 * 설문조사 & 실시간 투표 앱 (스마트폰 & Windows 최적화)
 * - 첫 화면: 오직 "작성하기" 메뉴 아이콘 하나만 노출
 * - 암호 확인: "77777"
 * - 작성 화면: 첫 번째 질문 칸 + 첫 번째 보기 칸 2개만 초기 노출
 *   질문 칸 바로 옆 작은 + 버튼 -> 다음 질문 추가
 *   보기 칸 바로 옆 작은 + 버튼 -> 다음 보기 추가
 * - 작성완료: GitHub Pages 주소를 활용하는 설문조사 링크 생성
 * - 일반 사용자 투표 & 결과보기: 항목별 투표수, 득표율(%), 최다 득표 뱃지, 그래프 실시간 표시
 */

const ADMIN_PASSCODE = "77777";
const STORAGE_PREFIX = "VOTE_APP_V1_";
const GITHUB_BASE_KEY = "VOTE_APP_GITHUB_BASE_URL";

// GunDB 실시간 공용 릴레이 피어 (별도 가입 없이 여러 기기 간 투표 결과 실시간 동기화)
let gun = null;
try {
  if (typeof Gun !== "undefined") {
    gun = Gun({
      peers: [
        "https://gun-manhattan.herokuapp.com/gun",
        "https://relay.peer.ooo/gun"
      ],
      localStorage: true
    });
  }
} catch (err) {
  console.warn("GunDB init fallback to local storage:", err);
}

// 현재 앱 상태
let builderState = [
  {
    q: "",
    opts: [""] // 초기에는 첫 번째 질문 칸과 첫 번째 보기 칸 딱 2개만 표시
  }
];

let currentPoll = null; // { id, createdAt, questions: [{ q, opts: [] }] }
let currentVotes = {};  // { "qIndex_oIndex": { voterId: 1 } }
let gunSubscription = null;

// DOM 참조
const views = {
  home: document.getElementById("view-home"),
  builder: document.getElementById("view-builder"),
  share: document.getElementById("view-share"),
  vote: document.getElementById("view-vote"),
  results: document.getElementById("view-results")
};

const modalPassword = document.getElementById("modal-password");
const formPassword = document.getElementById("form-password");
const inputPassword = document.getElementById("input-password");
const passwordError = document.getElementById("password-error");

const questionsContainer = document.getElementById("questions-container");
const formBuilder = document.getElementById("form-builder");

const inputShareUrl = document.getElementById("input-share-url");
const copyToast = document.getElementById("copy-toast");
const inputGithubBase = document.getElementById("input-github-base");

const voteQuestionsContainer = document.getElementById("vote-questions-container");
const formVote = document.getElementById("form-vote");
const voteAlert = document.getElementById("vote-alert");

const resultsQuestionsContainer = document.getElementById("results-questions-container");
const resultsSummaryText = document.getElementById("results-summary-text");

// 기기 고유 투표자 ID 생성 (중복 투표 업데이트용)
function getVoterId() {
  let vid = localStorage.getItem(STORAGE_PREFIX + "VOTER_ID");
  if (!vid) {
    vid = "v_" + Math.random().toString(36).substring(2, 10) + "_" + Date.now().toString(36);
    localStorage.setItem(STORAGE_PREFIX + "VOTER_ID", vid);
  }
  return vid;
}

// 화면 전환 함수
function showView(viewName) {
  Object.keys(views).forEach((key) => {
    if (key === viewName) {
      views[key].classList.remove("hidden");
    } else {
      views[key].classList.add("hidden");
    }
  });
  window.scrollTo({ top: 0, behavior: "smooth" });
  if (typeof lucide !== "undefined") {
    lucide.createIcons();
  }
}

// ========================================================
// 1. 첫 메뉴 ("작성하기" 아이콘 클릭 -> 암호 "77777" 확인)
// ========================================================
document.getElementById("btn-start-create").addEventListener("click", () => {
  inputPassword.value = "";
  passwordError.classList.add("hidden");
  modalPassword.classList.remove("hidden");
  setTimeout(() => inputPassword.focus(), 60);
});

document.getElementById("btn-cancel-pw").addEventListener("click", () => {
  modalPassword.classList.add("hidden");
});

modalPassword.addEventListener("click", (e) => {
  if (e.target === modalPassword) {
    modalPassword.classList.add("hidden");
  }
});

formPassword.addEventListener("submit", (e) => {
  e.preventDefault();
  const entered = inputPassword.value.trim();
  if (entered === ADMIN_PASSCODE) {
    modalPassword.classList.add("hidden");
    initBuilderWithInitialTwoFields();
    showView("builder");
  } else {
    passwordError.classList.remove("hidden");
    inputPassword.select();
  }
});

// ========================================================
// 2. 설문조사 및 투표 작성기 (초기: 첫 번째 질문 칸 + 첫 번째 보기 칸 2개만)
// ========================================================
function initBuilderWithInitialTwoFields() {
  builderState = [
    {
      q: "",
      opts: [""] // 오직 1번 질문 칸 + 1번 보기 칸만 존재
    }
  ];
  renderBuilder();
}

function syncBuilderDomToState() {
  const qInputs = questionsContainer.querySelectorAll(".q-input");
  qInputs.forEach((input) => {
    const qIdx = Number(input.dataset.qIdx);
    if (builderState[qIdx]) {
      builderState[qIdx].q = input.value;
    }
  });

  const optInputs = questionsContainer.querySelectorAll(".opt-input");
  optInputs.forEach((input) => {
    const qIdx = Number(input.dataset.qIdx);
    const oIdx = Number(input.dataset.oIdx);
    if (builderState[qIdx] && typeof builderState[qIdx].opts[oIdx] !== "undefined") {
      builderState[qIdx].opts[oIdx] = input.value;
    }
  });
}

function renderBuilder(focusTarget = null) {
  questionsContainer.innerHTML = "";

  builderState.forEach((item, qIdx) => {
    const card = document.createElement("div");
    card.className = "question-card";

    // 질문 입력 영역 (바로 옆에 작은 + 버튼 배치)
    const qGroup = document.createElement("div");
    qGroup.className = "field-group";

    const qLabel = document.createElement("label");
    qLabel.className = "field-label";
    qLabel.textContent = `${qIdx + 1}번째 질문`;

    const qRow = document.createElement("div");
    qRow.className = "input-with-plus";

    const qInput = document.createElement("input");
    qInput.type = "text";
    qInput.className = "text-input q-input";
    qInput.dataset.qIdx = qIdx;
    qInput.placeholder = `${qIdx + 1}번째 질문을 입력하세요`;
    qInput.value = item.q;
    qInput.required = true;
    qInput.addEventListener("input", (e) => {
      builderState[qIdx].q = e.target.value;
    });

    // 질문 작성 칸 바로 옆 작은 + 버튼 -> 다음 질문 추가
    const addQBtn = document.createElement("button");
    addQBtn.type = "button";
    addQBtn.className = "small-plus-btn";
    addQBtn.title = "다음 질문 추가";
    addQBtn.textContent = "+";
    addQBtn.addEventListener("click", () => {
      syncBuilderDomToState();
      const insertIdx = qIdx + 1;
      builderState.splice(insertIdx, 0, { q: "", opts: [""] });
      renderBuilder({ type: "q", qIdx: insertIdx });
    });

    qRow.appendChild(qInput);
    qRow.appendChild(addQBtn);

    // 질문이 2개 이상일 때 삭제 버튼 제공
    if (builderState.length > 1) {
      const delQBtn = document.createElement("button");
      delQBtn.type = "button";
      delQBtn.className = "small-del-btn";
      delQBtn.title = "이 질문 삭제";
      delQBtn.textContent = "×";
      delQBtn.addEventListener("click", () => {
        syncBuilderDomToState();
        builderState.splice(qIdx, 1);
        renderBuilder();
      });
      qRow.appendChild(delQBtn);
    }

    qGroup.appendChild(qLabel);
    qGroup.appendChild(qRow);
    card.appendChild(qGroup);

    // 보기 입력 영역 (각 보기 칸 바로 옆에 작은 + 버튼 배치)
    const optsContainer = document.createElement("div");
    optsContainer.className = "options-container";

    item.opts.forEach((optVal, oIdx) => {
      const optRow = document.createElement("div");
      optRow.className = "option-row";

      const optLabel = document.createElement("label");
      optLabel.className = "field-label";
      optLabel.textContent = `${oIdx + 1}번째 보기`;

      const optInputWrap = document.createElement("div");
      optInputWrap.className = "input-with-plus";

      const optInput = document.createElement("input");
      optInput.type = "text";
      optInput.className = "text-input opt-input";
      optInput.dataset.qIdx = qIdx;
      optInput.dataset.oIdx = oIdx;
      optInput.placeholder = `${oIdx + 1}번째 보기를 입력하세요`;
      optInput.value = optVal;
      optInput.required = true;
      optInput.addEventListener("input", (e) => {
        builderState[qIdx].opts[oIdx] = e.target.value;
      });

      // 보기 칸 바로 옆 작은 + 버튼 -> 다음 보기 추가
      const addOptBtn = document.createElement("button");
      addOptBtn.type = "button";
      addOptBtn.className = "small-plus-btn";
      addOptBtn.title = "보기 추가";
      addOptBtn.textContent = "+";
      addOptBtn.addEventListener("click", () => {
        syncBuilderDomToState();
        const nextOptIdx = oIdx + 1;
        builderState[qIdx].opts.splice(nextOptIdx, 0, "");
        renderBuilder({ type: "opt", qIdx, oIdx: nextOptIdx });
      });

      optInputWrap.appendChild(optInput);
      optInputWrap.appendChild(addOptBtn);

      if (item.opts.length > 1) {
        const delOptBtn = document.createElement("button");
        delOptBtn.type = "button";
        delOptBtn.className = "small-del-btn";
        delOptBtn.title = "이 보기 삭제";
        delOptBtn.textContent = "×";
        delOptBtn.addEventListener("click", () => {
          syncBuilderDomToState();
          builderState[qIdx].opts.splice(oIdx, 1);
          renderBuilder();
        });
        optInputWrap.appendChild(delOptBtn);
      }

      optRow.appendChild(optLabel);
      optRow.appendChild(optInputWrap);
      optsContainer.appendChild(optRow);
    });

    card.appendChild(optsContainer);
    questionsContainer.appendChild(card);
  });

  if (focusTarget) {
    setTimeout(() => {
      if (focusTarget.type === "q") {
        const target = questionsContainer.querySelector(`.q-input[data-q-idx="${focusTarget.qIdx}"]`);
        if (target) target.focus();
      } else if (focusTarget.type === "opt") {
        const target = questionsContainer.querySelector(
          `.opt-input[data-q-idx="${focusTarget.qIdx}"][data-o-idx="${focusTarget.oIdx}"]`
        );
        if (target) target.focus();
      }
    }, 30);
  }
}

document.getElementById("btn-back-home").addEventListener("click", () => {
  clearUrlParams();
  showView("home");
});

// ========================================================
// 3. 작성완료 -> GitHub 주소 기반 공유 링크 생성
// ========================================================
function encodePollData(pollObj) {
  const json = JSON.stringify(pollObj);
  if (typeof LZString !== "undefined") {
    return LZString.compressToEncodedURIComponent(json);
  }
  return encodeURIComponent(btoa(unescape(encodeURIComponent(json))));
}

function decodePollData(encodedStr) {
  try {
    if (typeof LZString !== "undefined") {
      const decompressed = LZString.decompressFromEncodedURIComponent(encodedStr);
      if (decompressed) return JSON.parse(decompressed);
    }
    const json = decodeURIComponent(escape(atob(decodeURIComponent(encodedStr))));
    return JSON.parse(json);
  } catch (e) {
    console.error("Failed to decode poll data:", e);
    return null;
  }
}

function getEffectiveBaseUrl() {
  // 1) 이미 github.io 또는 웹서버(https)에서 실행 중이고 localhost가 아니면 현재 URL 사용
  const loc = window.location;
  if (loc.hostname.endsWith("github.io")) {
    return loc.origin + loc.pathname;
  }
  // 2) 사용자가 설정해 둔 GitHub Pages 기본 주소가 있으면 우선 사용
  const savedGithubUrl = localStorage.getItem(GITHUB_BASE_KEY);
  if (savedGithubUrl && savedGithubUrl.trim().startsWith("http")) {
    let clean = savedGithubUrl.trim();
    if (!clean.endsWith("/") && !clean.endsWith(".html")) {
      clean += "/";
    }
    return clean;
  }
  // 3) 기본값: 현재 접속 주소
  return loc.origin + loc.pathname;
}

function buildShareUrl(pollObj) {
  const encoded = encodePollData(pollObj);
  const base = getEffectiveBaseUrl();
  return `${base}?poll=${encoded}`;
}

formBuilder.addEventListener("submit", (e) => {
  e.preventDefault();
  syncBuilderDomToState();

  const cleanedQuestions = builderState
    .map((item) => ({
      q: item.q.trim(),
      opts: item.opts.map((o) => o.trim()).filter((o) => o.length > 0)
    }))
    .filter((item) => item.q.length > 0 && item.opts.length > 0);

  if (cleanedQuestions.length === 0) {
    alert("최소 1개의 질문과 1개 이상의 보기를 입력해 주세요.");
    return;
  }

  const pollId = "p_" + Date.now().toString(36) + "_" + Math.random().toString(36).substring(2, 7);
  currentPoll = {
    id: pollId,
    createdAt: Date.now(),
    questions: cleanedQuestions
  };

  // 로컬 및 GunDB에 설문 메타 저장
  localStorage.setItem(STORAGE_PREFIX + "POLL_" + pollId, JSON.stringify(currentPoll));
  if (gun) {
    gun.get("koreavote_polls_v1").get(pollId).get("meta").put(JSON.stringify(currentPoll));
  }

  // URL 해시/쿼리 업데이트 (새로고침해도 유지)
  const encoded = encodePollData(currentPoll);
  const newRelativeUrl = `${window.location.pathname}?poll=${encoded}`;
  window.history.pushState({ poll: currentPoll }, "", newRelativeUrl);

  // 공유 화면 세팅
  const savedBase = localStorage.getItem(GITHUB_BASE_KEY) || "";
  inputGithubBase.value = savedBase;
  inputShareUrl.value = buildShareUrl(currentPoll);
  copyToast.classList.add("hidden");

  subscribeToPollVotes(currentPoll.id);
  showView("share");
});

// GitHub Pages 기본 주소 적용 버튼
document.getElementById("btn-apply-github-base").addEventListener("click", () => {
  const val = inputGithubBase.value.trim();
  if (val) {
    localStorage.setItem(GITHUB_BASE_KEY, val);
  } else {
    localStorage.removeItem(GITHUB_BASE_KEY);
  }
  if (currentPoll) {
    inputShareUrl.value = buildShareUrl(currentPoll);
    copyTextToClipboard(inputShareUrl.value);
  }
});

function copyTextToClipboard(text) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(() => {
      copyToast.classList.remove("hidden");
      setTimeout(() => copyToast.classList.add("hidden"), 2500);
    });
  } else {
    inputShareUrl.select();
    document.execCommand("copy");
    copyToast.classList.remove("hidden");
    setTimeout(() => copyToast.classList.add("hidden"), 2500);
  }
}

document.getElementById("btn-copy-url").addEventListener("click", () => {
  copyTextToClipboard(inputShareUrl.value);
});

document.getElementById("btn-go-vote-now").addEventListener("click", () => {
  if (currentPoll) {
    renderVoteView(currentPoll);
    showView("vote");
  }
});

document.getElementById("btn-go-results-now").addEventListener("click", () => {
  if (currentPoll) {
    renderResultsView(currentPoll);
    showView("results");
  }
});

document.getElementById("btn-new-poll").addEventListener("click", () => {
  clearUrlParams();
  initBuilderWithInitialTwoFields();
  showView("builder");
});

// ========================================================
// 4. 일반 사용자 투표 화면 및 실시간 집계 연동
// ========================================================
function loadLocalVotes(pollId) {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + "VOTES_" + pollId);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

function saveLocalVotes(pollId, votesObj) {
  localStorage.setItem(STORAGE_PREFIX + "VOTES_" + pollId, JSON.stringify(votesObj));
}

function subscribeToPollVotes(pollId) {
  currentVotes = loadLocalVotes(pollId);

  if (!gun) return;

  const votesNode = gun.get("koreavote_polls_v1").get(pollId).get("votes");
  votesNode.map().on((optionIdxVal, voterKey) => {
    if (!voterKey || optionIdxVal === null || typeof optionIdxVal === "undefined") return;
    // voterKey 형식: `${voterId}__q${qIdx}` -> 값: 선택한 oIdx (정수)
    currentVotes[voterKey] = Number(optionIdxVal);
    saveLocalVotes(pollId, currentVotes);

    // 결과 화면이 열려 있으면 실시간으로 그래프 업데이트
    if (!views.results.classList.contains("hidden") && currentPoll) {
      renderResultsView(currentPoll);
    }
  });
}

function renderVoteView(poll) {
  voteQuestionsContainer.innerHTML = "";
  voteAlert.classList.add("hidden");

  const voterId = getVoterId();

  poll.questions.forEach((item, qIdx) => {
    const card = document.createElement("div");
    card.className = "question-card";

    const title = document.createElement("div");
    title.className = "vote-q-title";
    title.innerHTML = `<span class="q-num-badge">Q${qIdx + 1}</span><span>${escapeHtml(item.q)}</span>`;
    card.appendChild(title);

    const optList = document.createElement("div");
    optList.className = "vote-options-list";

    const prevSelected = currentVotes[`${voterId}__q${qIdx}`];

    item.opts.forEach((optText, oIdx) => {
      const label = document.createElement("label");
      label.className = "vote-option-label";
      if (prevSelected === oIdx) {
        label.classList.add("selected");
      }

      const radio = document.createElement("input");
      radio.type = "radio";
      radio.name = `vote_q_${qIdx}`;
      radio.value = oIdx;
      if (prevSelected === oIdx) {
        radio.checked = true;
      }

      radio.addEventListener("change", () => {
        optList.querySelectorAll(".vote-option-label").forEach((el) => el.classList.remove("selected"));
        if (radio.checked) {
          label.classList.add("selected");
        }
      });

      const span = document.createElement("span");
      span.className = "vote-option-text";
      span.textContent = optText;

      label.appendChild(radio);
      label.appendChild(span);
      optList.appendChild(label);
    });

    card.appendChild(optList);
    voteQuestionsContainer.appendChild(card);
  });
}

formVote.addEventListener("submit", (e) => {
  e.preventDefault();
  if (!currentPoll) return;

  const voterId = getVoterId();
  const selections = {};

  for (let qIdx = 0; qIdx < currentPoll.questions.length; qIdx++) {
    const checked = formVote.querySelector(`input[name="vote_q_${qIdx}"]:checked`);
    if (!checked) {
      voteAlert.textContent = `${qIdx + 1}번째 질문의 보기를 선택해 주세요.`;
      voteAlert.className = "alert-banner warn";
      voteAlert.classList.remove("hidden");
      return;
    }
    selections[qIdx] = Number(checked.value);
  }

  // 투표 결과 기록 (로컬 + GunDB 실시간 공유)
  const votesNode = gun ? gun.get("koreavote_polls_v1").get(currentPoll.id).get("votes") : null;

  Object.keys(selections).forEach((qIdx) => {
    const key = `${voterId}__q${qIdx}`;
    const chosenIdx = selections[qIdx];
    currentVotes[key] = chosenIdx;
    if (votesNode) {
      votesNode.get(key).put(chosenIdx);
    }
  });

  saveLocalVotes(currentPoll.id, currentVotes);

  voteAlert.textContent = "투표가 성공적으로 반영되었습니다! 아래 '결과보기' 버튼을 눌러 상세 결과를 확인하세요.";
  voteAlert.className = "alert-banner success";
  voteAlert.classList.remove("hidden");
});

// 투표 화면 하단 "결과보기" 버튼
document.getElementById("btn-show-results").addEventListener("click", () => {
  if (!currentPoll) return;
  renderResultsView(currentPoll);
  showView("results");
});

document.getElementById("btn-vote-to-home").addEventListener("click", () => {
  clearUrlParams();
  showView("home");
});

// ========================================================
// 5. 상세 투표 결과 화면 (각 항목별 투표수, %, 그래프, 최다 득표 표시)
// ========================================================
function renderResultsView(poll) {
  resultsQuestionsContainer.innerHTML = "";

  // 참여자 수 계산
  const uniqueVoters = new Set();
  Object.keys(currentVotes).forEach((k) => {
    const parts = k.split("__q");
    if (parts[0]) uniqueVoters.add(parts[0]);
  });

  resultsSummaryText.textContent = `총 ${uniqueVoters.size}명 참여 · 실시간으로 득표수와 비율(%)이 집계됩니다.`;

  poll.questions.forEach((item, qIdx) => {
    const card = document.createElement("div");
    card.className = "question-card";

    // 이 질문의 각 보기별 득표수 집계
    const counts = new Array(item.opts.length).fill(0);
    let totalForQuestion = 0;

    Object.keys(currentVotes).forEach((voterKey) => {
      if (voterKey.endsWith(`__q${qIdx}`)) {
        const chosenIdx = Number(currentVotes[voterKey]);
        if (chosenIdx >= 0 && chosenIdx < counts.length) {
          counts[chosenIdx] += 1;
          totalForQuestion += 1;
        }
      }
    });

    const maxCount = Math.max(...counts, 0);

    const header = document.createElement("div");
    header.className = "result-q-header";
    header.innerHTML = `
      <div class="vote-q-title" style="margin-bottom:0;">
        <span class="q-num-badge">Q${qIdx + 1}</span>
        <span>${escapeHtml(item.q)}</span>
      </div>
      <span class="total-votes-pill">총 ${totalForQuestion}표</span>
    `;
    card.appendChild(header);

    const barsList = document.createElement("div");
    barsList.className = "result-bars-list";

    item.opts.forEach((optText, oIdx) => {
      const count = counts[oIdx];
      const percent = totalForQuestion > 0 ? ((count / totalForQuestion) * 100).toFixed(1) : "0.0";
      const isWinner = totalForQuestion > 0 && count === maxCount && maxCount > 0;

      const row = document.createElement("div");
      row.className = "result-item" + (isWinner ? " is-winner" : "");

      row.innerHTML = `
        <div class="result-item-top">
          <div class="result-opt-name">
            <span>${escapeHtml(optText)}</span>
            ${isWinner ? '<span class="winner-crown">1위 최다득표</span>' : ""}
          </div>
          <div class="result-stats">
            <span class="stat-percent">${percent}%</span>
            <span class="stat-count">(${count}표)</span>
          </div>
        </div>
        <div class="progress-track">
          <div class="progress-fill" style="width: ${percent}%;"></div>
        </div>
      `;

      barsList.appendChild(row);
    });

    card.appendChild(barsList);
    resultsQuestionsContainer.appendChild(card);
  });
}

document.getElementById("btn-back-to-vote").addEventListener("click", () => {
  if (!currentPoll) return;
  renderVoteView(currentPoll);
  showView("vote");
});

document.getElementById("btn-copy-result-link").addEventListener("click", () => {
  if (!currentPoll) return;
  const url = buildShareUrl(currentPoll);
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(url).then(() => {
      alert("투표 사이트 링크가 복사되었습니다!\n" + url);
    });
  } else {
    prompt("아래 투표 링크를 복사하세요:", url);
  }
});

document.getElementById("btn-share-from-results").addEventListener("click", () => {
  if (!currentPoll) return;
  inputShareUrl.value = buildShareUrl(currentPoll);
  showView("share");
});

document.getElementById("btn-results-to-home").addEventListener("click", () => {
  clearUrlParams();
  showView("home");
});

// ========================================================
// 유틸리티 및 초기 라우팅 (?poll=... 링크 접속 시 즉시 투표 화면 오픈)
// ========================================================
function clearUrlParams() {
  window.history.pushState({}, "", window.location.pathname);
}

function escapeHtml(str) {
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function initAppFromUrl() {
  if (typeof lucide !== "undefined") {
    lucide.createIcons();
  }

  const params = new URLSearchParams(window.location.search);
  const encodedPoll = params.get("poll");

  if (encodedPoll) {
    const decoded = decodePollData(encodedPoll);
    if (decoded && decoded.questions && Array.isArray(decoded.questions)) {
      currentPoll = decoded;
      subscribeToPollVotes(currentPoll.id);
      renderVoteView(currentPoll);
      showView("vote");
      return;
    }
  }

  // 파라미터가 없으면 오직 "작성하기" 메뉴 아이콘 하나만 있는 첫 화면 표시
  showView("home");
}

window.addEventListener("popstate", () => {
  initAppFromUrl();
});

document.addEventListener("DOMContentLoaded", initAppFromUrl);
