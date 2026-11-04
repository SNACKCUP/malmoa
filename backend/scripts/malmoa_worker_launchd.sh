#!/bin/zsh
# 말모아 Mac 작업자를 Mac 로그인 때 자동으로 켜기 (launchd, 통합 단계 5-3 결정 D)
# 사용법:  scripts/malmoa_worker_launchd.sh print | install | uninstall | status
#   print      등록할 설정(plist)만 보여 준다 (아무것도 바꾸지 않음)
#   install    ~/Library/LaunchAgents 에 등록하고 바로 켠다. 꺼지면 다시 켠다
#   uninstall  끄고 등록을 지운다
#   status     켜져 있는지
# 열쇠·주소는 plist 에 넣지 않는다 — 작업자가 ~/.malmoa-worker.env(권한 600)에서 읽는다.
# 기록: ~/Library/Logs/malmoa-worker.log. 시간 밖에 바로 처리하려면: uv run python scripts/malmoa_worker.py --now

LABEL=com.snackcup.malmoa-worker
BACKEND="${0:A:h:h}"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
LOG="$HOME/Library/Logs/malmoa-worker.log"
UV="$(command -v uv)"

plist() {
  cat <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>ProgramArguments</key>
  <array>
    <string>$UV</string><string>run</string><string>python</string><string>scripts/malmoa_worker.py</string>
  </array>
  <key>WorkingDirectory</key><string>$BACKEND</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>60</integer>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
EOF
}

case "$1" in
  print)
    plist
    ;;
  install)
    [[ -x "$UV" ]] || { echo "uv 를 찾을 수 없습니다."; exit 1; }
    [[ -f "$HOME/.malmoa-worker.env" ]] || { echo "~/.malmoa-worker.env 가 없습니다 (MALMOA_API_URL, MALMOA_WORKER_TOKEN). 먼저 만드세요."; exit 1; }
    chmod 600 "$HOME/.malmoa-worker.env"
    mkdir -p "${PLIST:h}" "${LOG:h}"
    plist > "$PLIST"
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null
    launchctl bootstrap "gui/$(id -u)" "$PLIST" && echo "등록했습니다: $PLIST (기록: $LOG)"
    ;;
  uninstall)
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null
    rm -f "$PLIST" && echo "지웠습니다: $PLIST"
    ;;
  status)
    launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null | grep -E "state|pid" || echo "등록되어 있지 않습니다."
    ;;
  *)
    echo "사용법: $0 print | install | uninstall | status"
    exit 1
    ;;
esac
