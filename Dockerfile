# صورة تشغيل خفيفة — تصلح لـ Fly.io و Railway و Koyeb و Cloud Run وأي خادم يدعم Docker
FROM node:22-alpine

ENV NODE_ENV=production
WORKDIR /app

# طبقة الاعتماديات أولاً للاستفادة من الكاش
COPY package.json package-lock.json ./
RUN npm ci --omit=dev

COPY server ./server
COPY public ./public

# المنصات تحقن PORT عادةً؛ ٣٠٠٠ قيمة افتراضية
ENV PORT=3000
EXPOSE 3000

# لا تعمل كـ root
USER node

HEALTHCHECK --interval=30s --timeout=5s --start-period=5s \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/api/health').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"

CMD ["node", "server/index.js"]
