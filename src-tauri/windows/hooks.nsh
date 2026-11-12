; kMonitor installer hooks (Tauri NSIS). The installer runs per machine, as administrator.

!macro NSIS_HOOK_PREINSTALL
  ; Versions up to 0.1.0 installed per user in %LOCALAPPDATA%\kMonitor, a folder any program
  ; running as the user can write to. Remove that copy (settings and history live elsewhere).
  ReadEnvStr $2 LOCALAPPDATA
  IfFileExists "$2\kMonitor\uninstall.exe" 0 kmonitor_old_done
    ExecWait '"$2\kMonitor\uninstall.exe" /S _?=$2\kMonitor'
    RMDir /r "$2\kMonitor"
  kmonitor_old_done:
!macroend

!macro NSIS_HOOK_POSTINSTALL
  ; Admin mode: point the logon task (if any) at this protected copy.
  nsExec::Exec 'schtasks /Change /TN kMonitor /TR "\"$INSTDIR\${MAINBINARYNAME}.exe\" --tray"'
  Pop $0

  ; Offer PawnIO, the signed driver used for CPU temperature and power, if it's not there yet.
  ReadRegStr $0 HKLM "SYSTEM\CurrentControlSet\Services\PawnIO" "ImagePath"
  StrCmp $0 "" 0 kmonitor_pawnio_done
  ; Silent installs (updates) never pull in a driver on their own.
  IfSilent kmonitor_pawnio_done

  ; The question in the installer's language ($LANGUAGE is a Windows LANGID).
  StrCpy $1 "Install PawnIO too?$\r$\n$\r$\nIt is a free, signed driver that lets kMonitor read the processor's temperature and power.$\r$\n$\r$\nWithout it, everything else in kMonitor works normally."
  StrCmp $LANGUAGE 1046 0 +2
    StrCpy $1 "Instalar também o PawnIO?$\r$\n$\r$\nÉ um driver gratuito e assinado que permite ao kMonitor ler a temperatura e o consumo do processador.$\r$\n$\r$\nSem ele, todo o resto do kMonitor funciona normalmente."
  StrCmp $LANGUAGE 1034 kmonitor_es
  StrCmp $LANGUAGE 3082 kmonitor_es kmonitor_ask
  kmonitor_es:
    StrCpy $1 "¿Instalar también PawnIO?$\r$\n$\r$\nEs un driver gratuito y firmado que permite a kMonitor leer la temperatura y el consumo del procesador.$\r$\n$\r$\nSin él, todo lo demás de kMonitor funciona con normalidad."
  kmonitor_ask:
  MessageBox MB_YESNO|MB_ICONQUESTION "$1" /SD IDNO IDNO kmonitor_pawnio_done
  ExecShellWait "open" "$INSTDIR\PawnIO_setup.exe" "-install -silent"
  kmonitor_pawnio_done:
!macroend

!macro NSIS_HOOK_POSTUNINSTALL
  ; A real uninstall removes the admin logon task; a silent one (reinstall/update) keeps it.
  IfSilent kmonitor_task_kept
    nsExec::Exec 'schtasks /Delete /TN kMonitor /F'
    Pop $0
  kmonitor_task_kept:
!macroend
