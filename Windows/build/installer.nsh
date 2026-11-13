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
!macroend
