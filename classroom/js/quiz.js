/* 江山课堂 · 课堂快测组件（独立无依赖） */
(function () {
  "use strict";

  const Quiz = {
    /**
     * 渲染一组题目到容器。
     * @param {HTMLElement} mount 容器
     * @param {Array} items [{q, options[], answer, explain, link?}]
     * @param {{onTrace?: Function}} handlers
     */
    render(mount, items, handlers) {
      mount.innerHTML = "";
      (items || []).forEach((item, qi) => {
        const box = document.createElement("div");
        box.className = "quiz-item";

        const q = document.createElement("p");
        q.className = "quiz-q";
        q.textContent = `${qi + 1}. ${item.q}`;
        box.appendChild(q);

        const opts = document.createElement("div");
        opts.className = "quiz-opts";
        const buttons = [];

        item.options.forEach((opt, oi) => {
          const btn = document.createElement("button");
          btn.type = "button";
          btn.textContent = opt;
          btn.addEventListener("click", () => {
            buttons.forEach((b, bi) => {
              b.disabled = true;
              if (bi === item.answer) b.classList.add("correct");
            });
            if (oi !== item.answer) btn.classList.add("wrong");
            if (window.jsTrack) jsTrack("quiz_answer", oi === item.answer ? "correct" : "wrong");
            showExplain();
          });
          buttons.push(btn);
          opts.appendChild(btn);
        });
        box.appendChild(opts);

        const explainWrap = document.createElement("div");
        explainWrap.style.display = "none";
        const explain = document.createElement("p");
        explain.className = "quiz-explain";
        explain.textContent = item.explain || "";
        explainWrap.appendChild(explain);

        if (item.link && handlers && typeof handlers.onTrace === "function") {
          const trace = document.createElement("a");
          trace.className = "quiz-trace-link";
          trace.href = "#";
          trace.textContent = "→ 在地图上回看史实";
          trace.addEventListener("click", (e) => {
            e.preventDefault();
            handlers.onTrace(item.link);
          });
          explainWrap.appendChild(trace);
        }
        box.appendChild(explainWrap);

        function showExplain() { explainWrap.style.display = "block"; }
        mount.appendChild(box);
      });
    }
  };

  window.ClassroomQuiz = Quiz;
})();
