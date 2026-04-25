#!/bin/bash
# RIFF banner - turquoise gradient
# Usage: source banner.sh  OR  bash banner.sh

# Turquoise gradient (dark to bright)
C1='\033[38;2;0;130;130m'
C2='\033[38;2;0;160;155m'
C3='\033[38;2;0;190;180m'
C4='\033[38;2;0;215;205m'
C5='\033[38;2;0;240;230m'
CS='\033[38;2;90;190;185m'
CD='\033[2m'
NC='\033[0m'

echo ""
echo -e "${C1} ____  ___ _____ _____ ${NC}"
echo -e "${C2}|  _ \\|_ _|  ___|  ___|${NC}"
echo -e "${C3}| |_) || || |_  | |_   ${NC}"
echo -e "${C4}|  _ < | ||  _| |  _|  ${NC}"
echo -e "${C5}|_| \\_\\___|_|   |_|    ${NC}"
echo ""
echo -e "${CS}Build like a band of six. Ship like one.${NC}"
echo -e "${CD}Solo dev framework for Claude Code${NC}"
echo ""
