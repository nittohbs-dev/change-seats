# 座席管理アプリの Docker イメージ。Java の実行環境に、このPCで作った jar と画面（web/）を入れる
# 使い方は README.md の「Docker で動かす」
#
# jar はこのPCで作る（start.bat rebuild、または tools/maven/bin/mvn.cmd -f server/pom.xml -DskipTests package）。
# コンテナの中の Maven は、会社のネットワークの証明書の検査（PKIX）で部品をダウンロードできないため。
FROM eclipse-temurin:21-jre
WORKDIR /app
COPY server/target/seat-app-0.1.0.jar app.jar
COPY web/ web/
ENV WEB_DIR=/app/web \
    PORT=8081 \
    TZ=Asia/Tokyo
EXPOSE 8081
CMD ["java", "-jar", "app.jar"]
