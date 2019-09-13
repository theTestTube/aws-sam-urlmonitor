# URLMonitor

## Features

- [x] Get notified by mail (SNS) on HTTP URL content update 
    - [x] detecting changes on `last-modified` response header
    - [x] detecting changes on body checksum (crc)
    - [ ] text difference on notification (attached to?)
    - [ ] create SNS topic subscription from an e-mail address

- [ ] Specify change minimum period per URL, so if request response `last-modified` is too recent no scraping results are produced

## Getting started

``` text
.
├── README.MD                   <-- This instructions file
├── scraping                    <-- Source code for a Lambda function
│   ├── events                  <-- Function input event payloads
│   │   ├── create.json         <-- API Gateway Integration, create
│   │   ├── read.json           <-- API Gateway Integration, read
│   │   ├── schedule.json       <-- Schedule Integration
│   │   └── event.json          <-- API Gateway Proxy Integration
│   ├── app.js                  <-- Function code
│   ├── tests                   <-- Unit tests
│   │   └── unit
│   │       └── test-handler.js
│   └── package.json            <-- NodeJS scripts
├── dependencies                <-- Layer source code for Lambda function
│   └── nodejs                  <-- NodeJS layer runtime
│       └── package.json        <-- NodeJS dependencies
└── template.yaml               <-- SAM template
```

## Requirements

* AWS CLI already configured with Administrator permission
* [NodeJS 8.10+ installed](https://nodejs.org/en/download/)
* [Docker installed](https://www.docker.com/community-edition)
* [AWS DynamoDB locally running](https://docs.aws.amazon.com/es_es/amazondynamodb/latest/developerguide/DynamoDBLocal.Docker.html) with `docker run -p 8000:8000 amazon/dynamodb-local`
* AWS SNS topic configured

## Setup process

### Building the project

The very first time or whenever you make changes to your dependency manifest install your NodeJS modules as usual:

```bash
cd dependencies/nodejs
npm install
```

[AWS Lambda requires a flat folder](https://docs.aws.amazon.com/lambda/latest/dg/nodejs-create-deployment-pkg.html) with the application as well as its dependencies in a `node_modules` folder. When you make changes to your source code run the following command to build your project local for testing and deployment:

```bash
sam build
```

If your dependencies contain native modules that need to be compiled specifically for the operating system running on AWS Lambda, use this command to build inside a Lambda-like Docker container instead:
```bash
sam build --use-container
```

By default, this command writes built artifacts to `.aws-sam/build` folder.

### Local development

⚠️ SNS notification isn't effective under local development.

**Invoking function locally using a local sample payload**

```bash
sam local invoke ScrapingResultsFunction --event scraping/events/read.json
```

**Invoking function locally using a different DynamoDB URL (my docker-machine doesn't support host.docker.internal hostname)**
```bash
sam local invoke ScrapingResultsFunction --event scraping/events/read.json --parameter-overrides "ParameterKey=DynamoDBEndpoint,ParameterValue=http://192.168.99.100:8000"
```
 
**Invoking function locally through local API Gateway**

```bash
sam local start-api
```

If the previous command ran successfully you should now be able to hit the following local endpoint to invoke your function `http://localhost:3000/scraping/results`

**Debuging function with Visual Studio Code**

```bash
sam local invoke ScrapingResultsFunction --event scraping/events/read.json --debug-port 5858
```

Add Visual Studio Code debuging [launch configuration](.vscode/launch.json) and start debuging with `Attach to SAM CLI - scraping`.

**SAM CLI** is used to emulate both Lambda and API Gateway locally and uses our `template.yaml` to understand how to bootstrap this environment (runtime, where the source code is, etc.) - The following excerpt is what the CLI will read in order to initialize an API and its routes:

```yaml
...
Events:
    ScrapingResults:
        Type: Api # More info about API Event Source: https://github.com/awslabs/serverless-application-model/blob/master/versions/2016-10-31.md#api
        Properties:
            Path: /scraping/results
            Method: get
```

## Packaging and deployment

AWS Lambda NodeJS runtime requires a flat folder including the application. SAM will use `CodeUri` property to know where to look up the application:

```yaml
...
    ScrapingResultsFunction:
        Type: AWS::Serverless::Function
        Properties:
            CodeUri: scraping/
            # ...
```

A layer provieds NodeJS runtime with all dependencies. SAM will use `ContentUri` property to know where to look up for dependencies:

```yaml
...
    ScrapingDependencies:
        Type: AWS::Serverless::LayerVersion
        Properties:
            ContentUri: dependencies/
```

Firstly, we need a `S3 bucket` where we can upload our Lambda functions packaged as ZIP before we deploy anything - If you don't have a S3 bucket to store code artifacts then this is a good time to create one:

```bash
BUCKET_NAME=thetesttube-artifacts
aws s3 mb s3://$BUCKET_NAME
```

Next, run the following command to package our Lambda function to S3:

```bash
sam package \
    --output-template-file packaged.yaml \
    --s3-bucket $BUCKET_NAME \
    --s3-prefix scripts/URLMonitor
```

Next, the following command will create a Cloudformation Stack and deploy your SAM resources.

```bash
sam deploy \
    --template-file packaged.yaml \
    --stack-name DE-SCRIPTS-URLMONITOR \
    --capabilities CAPABILITY_IAM
```

If you want to use a `SNS_TOPIC` different of default (`URLMonitor`), you can specify it at deployment time.

```bash
SNS_TOPIC=mytopic
sam deploy \
    --template-file packaged.yaml \
    --stack-name DE-SCRIPTS-URLMONITOR \
    --capabilities CAPABILITY_IAM \
    --parameter-overrides Topic=$SNS_TOPIC
```

> **See [Serverless Application Model (SAM) HOWTO Guide](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-quick-start.html) for more details in how to get started.**

After deployment is complete you can run the following command to retrieve the API Gateway Endpoint URL:

```bash
aws cloudformation describe-stacks \
    --stack-name DE-SCRIPTS-URLMONITOR \
    --query 'Stacks[].Outputs[?OutputKey==`ScrapingApi`]' \
    --output table
``` 

## Fetch, tail, and filter Lambda function logs

To simplify troubleshooting, SAM CLI has a command called sam logs. sam logs lets you fetch logs generated by your Lambda function from the command line. In addition to printing the logs on the terminal, this command has several nifty features to help you quickly find the bug.

`NOTE`: This command works for all AWS Lambda functions; not just the ones you deploy using SAM.

```bash
sam logs -n ScrapingResultsFunction --stack-name DE-SCRIPTS-URLMONITOR --tail
```

You can find more information and examples about filtering Lambda function logs in the [SAM CLI Documentation](https://docs.aws.amazon.com/serverless-application-model/latest/developerguide/serverless-sam-cli-logging.html).

## Testing

We use `mocha` for testing our code and it is already added in `package.json` under `scripts`, so that we can simply run the following command to run our tests:

```bash
cd scraping
npm install
npm run test
```

## Cleanup

In order to delete our Serverless Application recently deployed you can use the following AWS CLI Command:

```bash
aws cloudformation delete-stack --stack-name DE-SCRIPTS-URLMONITOR
```

## DynamoDB Administration

``` bash
npm install dynamodb-admin -g
export DYNAMO_ENDPOINT=http://localhost:8000
dynamodb-admin --open
```

Or better call `npm run-script dynamodb-admin`.