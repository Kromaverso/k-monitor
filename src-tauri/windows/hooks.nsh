; kMonitor installer hooks (Tauri NSIS).
; Offers PawnIO, the signed driver kMonitor uses for CPU temperature and power.

!macro NSIS_HOOK_POSTINSTALL
  ; Already installed? The driver registers the "PawnIO" service.
  ReadRegStr $0 HKLM "SYSTEM\CurrentControlSet\Services\PawnIO" "ImagePath"
  StrCmp $0 "" 0 kmonitor_pawnio_done
  ; Silent installs (updates) never pull in a driver on their own.
  IfSilent kmonitor_pawnio_done

  ; The question in the installer's language ($LANGUAGE is a Windows LANGID).
  StrCpy $1 "Install PawnIO too?$\r$\n$\r$\nIt is a free, signed driver that lets kMonitor read the processor's temperature and power. Windows will ask for administrator permission.$\r$\n$\r$\nWithout it, everything else in kMonitor works normally."
  StrCmp $LANGUAGE 1046 0 +2
    StrCpy $1 "Instalar também o PawnIO?$\r$\n$\r$\nÉ um driver gratuito e assinado que permite ao kMonitor ler a temperatura e o consumo do processador. O Windows vai pedir permissão de administrador.$\r$\n$\r$\nSem ele, todo o resto do kMonitor funciona normalmente."
  StrCmp $LANGUAGE 1034 kmonitor_es
  StrCmp $LANGUAGE 3082 kmonitor_es kmonitor_ask
  kmonitor_es:
    StrCpy $1 "¿Instalar también PawnIO?$\r$\n$\r$\nEs un driver gratuito y firmado que permite a kMonitor leer la temperatura y el consumo del procesador. Windows pedirá permiso de administrador.$\r$\n$\r$\nSin él, todo lo demás de kMonitor funciona con normalidad."
  kmonitor_ask:
  MessageBox MB_YESNO|MB_ICONQUESTION "$1" /SD IDNO IDNO kmonitor_pawnio_done
  ; PawnIO's setup requires administrator; ShellExecute shows the UAC prompt.
  ExecShellWait "open" "$INSTDIR\PawnIO_setup.exe" "-install -silent"
  kmonitor_pawnio_done:
!macroend
