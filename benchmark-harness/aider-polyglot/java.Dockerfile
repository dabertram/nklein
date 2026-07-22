FROM eclipse-temurin@sha256:9d8dcf999b0bce2453e913823595a5ff2a4e8e9e5d5241b45280d0ff069818ec

ARG GRADLE_VERSION=8.7
ARG GRADLE_SHA256=544c35d6bd849ae8a5ed0bcea39ba677dc40f49df7d1835561582da2009b961d

RUN curl --fail --location --silent --show-error \
      "https://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip" \
      --output /tmp/gradle.zip \
    && echo "${GRADLE_SHA256}  /tmp/gradle.zip" | sha256sum --check --strict \
    && mkdir -p /opt/gradle \
    && cd /opt/gradle \
    && jar xf /tmp/gradle.zip \
    && rm /tmp/gradle.zip \
    && chmod 0555 "/opt/gradle/gradle-${GRADLE_VERSION}/bin/gradle" \
    && ln -s "/opt/gradle/gradle-${GRADLE_VERSION}/bin/gradle" /usr/local/bin/gradle

WORKDIR /opt/cache-seed
COPY java-build.gradle build.gradle
COPY java-settings.gradle settings.gradle
RUN gradle --no-daemon --gradle-user-home /opt/gradle-cache seedTestDependencies \
    && rm -rf /opt/gradle-cache/daemon /opt/gradle-cache/caches/*/fileHashes
