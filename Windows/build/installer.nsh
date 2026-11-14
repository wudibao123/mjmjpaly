; MJMJ 安装脚本扩展：
;   1) 安装过程中把每一步在做的事打印到安装页的详情区（配合模板里 ShowInstDetails show / SetDetailsPrint both）
;   2) 安装完成把 resources\cli 登记进用户 PATH，卸载时移除
!macro customInstall
  ; 解压文件阶段由 NSIS 逐条打印"正在解压: xxx"，这里继续补后续步骤
  DetailPrint "正在写入程序清单与注册表信息..."
  DetailPrint "正在注册 mjplay 命令行到用户 PATH..."
  ExecWait 'powershell -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\cli\register-path.ps1" -Action add -Dir "$INSTDIR\resources\cli"'
  DetailPrint "正在创建桌面与开始菜单快捷方式..."
  DetailPrint "正在收尾，安装即将完成..."
!macroend

!macro customUnInstall
  DetailPrint "正在从用户 PATH 移除 mjplay 命令行..."
  ExecWait 'powershell -NoProfile -ExecutionPolicy Bypass -File "$INSTDIR\resources\cli\register-path.ps1" -Action remove -Dir "$INSTDIR\resources\cli"'
  DetailPrint "正在清理安装目录..."

  ; 卸载时问一句要不要连本地数据一起清掉。
  ; 静默卸载（/S）不弹窗，默认全部保留，避免自动化环境被卡住。
  IfSilent mjmjUnDone
  MessageBox MB_YESNOCANCEL|MB_ICONQUESTION \
    "卸载的同时，要不要一并清除本地数据？$\r$\n$\r$\n【是】删除登录信息 + 全部本地数据$\r$\n（账号登录态、播放与封面缓存、歌词设置、窗口位置）$\r$\n$\r$\n【否】只删登录信息$\r$\n（设置、缓存、窗口位置保留，下次装回来不用重新调）$\r$\n$\r$\n【取消】什么都不删$\r$\n（重新安装可直接继续用原账号）" \
    IDYES mjmjDelAll IDNO mjmjDelLogin
  Goto mjmjUnDone

  mjmjDelAll:
    RMDir /r "$APPDATA\MJMJ"
    DetailPrint "已删除登录信息与全部本地数据"
    Goto mjmjUnDone

  mjmjDelLogin:
    Delete "$APPDATA\MJMJ\auth.json"
    RMDir /r "$APPDATA\MJMJ\Local Storage"
    RMDir /r "$APPDATA\MJMJ\Session Storage"
    RMDir /r "$APPDATA\MJMJ\Network"
    RMDir /r "$APPDATA\MJMJ\Cookies"
    DetailPrint "已删除登录信息，设置与缓存保留"

  mjmjUnDone:
!macroend
