# Tectonic Compile MSA

Stateless LaTeX→PDF compiler. xelatex + kotex + Nanum/Noto CJK fonts.

## Run locally

    docker compose --profile pro up tectonic

## API

POST /compile  — see server.py
GET  /healthz  — liveness
