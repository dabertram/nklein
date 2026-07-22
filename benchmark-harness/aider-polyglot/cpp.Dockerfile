FROM gcc@sha256:5e927c284bf55a7dc796262e311a0703344f62f41f5621eb56843111b1d37e15

RUN apt-get update \
    && apt-get install --yes --no-install-recommends cmake=3.25.1-1 \
    && rm -rf /var/lib/apt/lists/*

COPY cpp-test.sh /usr/local/bin/aider-polyglot-test
RUN chmod 0555 /usr/local/bin/aider-polyglot-test

