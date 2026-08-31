# Music House's own MiniMax Music3 worker. It deliberately contains no model
# weights: the immutable Music House Novita volume supplies those at runtime.
FROM nvidia/cuda:12.8.1-cudnn-devel-ubuntu24.04

ARG SGLANG_OMNI_REF=5b2d8852f87d0180e82b5b6ea8d1e5a8b6f3b9a7
ENV DEBIAN_FRONTEND=noninteractive \
    PATH=/opt/venv/bin:$PATH \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

RUN apt-get update && apt-get install -y --no-install-recommends \
    ca-certificates curl ffmpeg git python3 python3-pip python3-venv \
    && rm -rf /var/lib/apt/lists/* \
    && python3 -m venv /opt/venv \
    && pip install --upgrade pip setuptools wheel

# sglang-omni is the official MiniMax Music3 OpenAI-compatible server. Pinning
# the source revision makes a model-volume upgrade an explicit operation.
RUN git clone https://github.com/sgl-project/sglang-omni.git /opt/sglang-omni \
    && cd /opt/sglang-omni \
    && git checkout "${SGLANG_OMNI_REF}" \
    && pip install -v .

COPY app /app
RUN chmod +x /app/entrypoint.sh
ENTRYPOINT ["/app/entrypoint.sh"]
