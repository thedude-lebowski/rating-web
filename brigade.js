const { events, Job, Group } = require('brigadier')

events.on("push", (brigadeEvent, project) => {
    
    // setup variables
    var gitPayload = JSON.parse(brigadeEvent.payload)
    var brigConfig = new Map()
    brigConfig.set("acrServer", project.secrets.acrServer)
    brigConfig.set("acrUsername", project.secrets.acrUsername)
    brigConfig.set("acrPassword", project.secrets.acrPassword)
    brigConfig.set("webImage", "chzbrgr71/rating-web")
    brigConfig.set("apiImage", "chzbrgr71/rating-api")
    brigConfig.set("gitSHA", brigadeEvent.commit.substr(0,7))
    brigConfig.set("eventType", brigadeEvent.type)
    brigConfig.set("branch", getBranch(gitPayload))
    brigConfig.set("imageTag", `${brigConfig.get("branch")}-${brigConfig.get("gitSHA")}`)
    brigConfig.set("webACRImage", `${brigConfig.get("acrServer")}/${brigConfig.get("webImage")}`)
    brigConfig.set("apiACRImage", `${brigConfig.get("acrServer")}/${brigConfig.get("apiImage")}`)
    
    console.log(`==> gitHub webook (${brigConfig.get("branch")}) with commit ID ${brigConfig.get("gitSHA")}`)
    
    // setup brigade jobs
    var docker = new Job("job-runner-docker")
    var helm = new Job("job-runner-helm")
    dockerJobRunner(brigConfig, docker)
    helmJobRunner(brigConfig, helm, "prod")
    
    // start pipeline
    console.log(`==> starting pipeline for docker image: ${brigConfig.get("webACRImage")}:${brigConfig.get("imageTag")}`)
    console.log(`==> and pipeline for docker image: ${brigConfig.get("apiACRImage")}:${brigConfig.get("imageTag")}`)
    var pipeline = new Group()
    pipeline.add(docker)
    pipeline.add(helm)
    if (brigConfig.get("branch") == "master") {
        pipeline.runEach()
    } else {
        console.log(`==> no jobs to run when not master`)
    }  
})

events.on("after", (event, proj) => {
    console.log("brigade pipeline finished successfully")

    var slack = new Job("slack-notify", "technosophos/slack-notify:latest", ["/slack-notify"])
    slack.storage.enabled = false
    slack.env = {
      SLACK_WEBHOOK: proj.secrets.slackWebhook,
      SLACK_USERNAME: "brigade-demo",
      SLACK_MESSAGE: "brigade pipeline finished successfully",
      SLACK_COLOR: "#ff0000"
    }
	slack.run()
    
})

function dockerJobRunner(config, d) {
    d.storage.enabled = false
    d.image = "chzbrgr71/dockernd:node"
    d.privileged = true
    d.tasks = [
        "dockerd-entrypoint.sh &",
        "echo waiting && sleep 20",
        "cd /src/rating-web/",
        `docker login ${config.get("acrServer")} -u ${config.get("acrUsername")} -p ${config.get("acrPassword")}`,
        `docker build --build-arg BUILD_DATE='1/1/2017 5:00' --build-arg IMAGE_TAG_REF=${config.get("imageTag")} --build-arg VCS_REF=${config.get("gitSHA")} -t ${config.get("webImage")} .`,
        "cd ../rating-api/",
        `docker build --build-arg BUILD_DATE='1/1/2017 5:00' --build-arg IMAGE_TAG_REF=${config.get("imageTag")} --build-arg VCS_REF=${config.get("gitSHA")} -t ${config.get("apiImage")} .`,
        `docker tag ${config.get("webImage")} ${config.get("webACRImage")}:${config.get("imageTag")}`,
        `docker tag ${config.get("apiImage")} ${config.get("apiACRImage")}:${config.get("imageTag")}`,
        `docker push ${config.get("webACRImage")}:${config.get("imageTag")}`,
        `docker push ${config.get("apiACRImage")}:${config.get("imageTag")}`,
        "killall dockerd"
    ]
}

function helmJobRunner (config, h, deployType) {
    h.storage.enabled = false
    h.image = "lachlanevenson/k8s-helm:2.7.0"
    h.tasks = [
        "cd /src/",
        `helm upgrade --install ratings ./charts/ratings --set api.image=${config.get("apiACRImage")} --set api.imageTag=${config.get("imageTag")} --set web.image=${config.get("webACRImage")} --set web.imageTag=${config.get("imageTag")}`
    ]
}

function slackJob (s, webhook, message) {
    s.storage.enabled = false
    s.env = {
      SLACK_WEBHOOK: webhook,
      SLACK_USERNAME: "brigade-demo",
      SLACK_MESSAGE: message,
      SLACK_COLOR: "#0000ff"
    }
}

function getBranch (p) {
    if (p.ref) {
        return p.ref.substring(11)
    } else {
        return "PR"
    }
}