FROM mcr.microsoft.com/playwright:v1.56.1-noble
WORKDIR /opt/runner
RUN npm init -y && npm install --save-exact playwright@1.56.1 && npm cache clean --force
ENV NODE_PATH=/opt/runner/node_modules
USER 1000:1000
WORKDIR /project
CMD ["node", "--version"]
