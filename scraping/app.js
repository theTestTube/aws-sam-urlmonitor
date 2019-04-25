// import { Persistence, Persistent } from './persistence'

const dynamoose = require('dynamoose')
const uuidv1 = require('uuid/v1')
const AWS = require('aws-sdk')

class Persistent {
  constructor (scheme) {
    this._scheme = { ...{ id: String }, ...scheme }

    // @todo
    // let id = uuidv1()
    // if (object) // @todo is object
    // {
    //   object['id'] = id
    // } else {
    //   object = { id: uuidv1() }
    // }
  }

  get name () {
    return this.constructor.name
  }

  get scheme () {
    return this._scheme
  }
}

class Persistence {
  constructor (persistent) {
    if (process.env.AWS_SAM_LOCAL === 'true') {
      this._instance = dynamoose.local('http://host.docker.internal:8000')
    } else {
      dynamoose.AWS.config.update({ // @todo really required?
        region: 'eu-central-1'
      })
      this._instance = dynamoose.ddb()
    }
    this._persistent = persistent
  }

  get model () {
    // @todo prefix name table acordingly with env, project & vertical, 'DE-SCRIPTS-URLMONITOR'
    return dynamoose.model(process.env.TABLE_NAME || this._persistent.name, this._persistent.scheme)
  }

  get instance () {
    return this._instance
  }
}

const axios = require('axios')

let response

/**
 *
 * Event doc: https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html#api-gateway-simple-proxy-for-lambda-input-format
 * @param {Object} event - API Gateway Lambda Proxy Input Format
 *
 * Context doc: https://docs.aws.amazon.com/lambda/latest/dg/nodejs-prog-model-context.html
 * @param {Object} context
 *
 * Return doc: https://docs.aws.amazon.com/apigateway/latest/developerguide/set-up-lambda-proxy-integrations.html
 * @returns {Object} object - API Gateway Lambda Proxy Output Format
 *
 */
exports.lambdaHandler = async (event, context) => {
  let processed = []
  try {
    if (!event.body) {
      throw new Error('event.body is required')
    }
    const body = (typeof event.body === 'object') ? event.body : JSON.parse(event.body)
    processed = await scrap(Array.isArray(body) ? body : [ body ], context)
  } catch (err) {
    console.log(err)
    return err
  }
  return processed
}

const scrap = async (urls, context) => {
  let results = []

  return Promise.all(
    urls.map(async instance => {
      let url = typeof (instance) === 'string' ? instance : instance.url
      console.log('querying ' + url + ' ...')
      // @todo axios or HTTP rejection errors
      //   Error: getaddrinfo EAI_AGAIN docs.aws.amazon.com:443
      //   at Object._errnoException (util.js:1022:11)
      //   at errnoException (dns.js:55:15)
      //   at GetAddrInfoReqWrap.onlookup [as oncomplete] (dns.js:92:26)
      // code: 'EAI_AGAIN',
      // errno: 'EAI_AGAIN',
      // syscall: 'getaddrinfo',
      await request(url, results, context)
    })
  ).then(() => results)
}

class Scraping extends Persistent {
  constructor () {
    super({
      'url': String,
      'modified': String,
      'created': String,
      'scraped': String,
      'content-type': String,
      'data': String,
      'diff': String
    })
  }
}

const createOrUpdate = async (object, context) => {
  try {
    const persistence = new Persistence(new Scraping())
    const scraping = persistence.model

    // let filter = {
    //   FilterExpression: 'url = :u',
    //   ExpressionAttributeValues: {
    //     ':u': body.url
    //   }
    // }
    // const read = await scraping.scan(filter).exec()

    // const read = await scraping.queryOne('url').eq(body['url']).exec()
    const read = await scraping.scan('url').eq(object['url']).exec()

    if (!read.count) {
      object['id'] = uuidv1() // @todo Out of here!
      object['created'] = object['scraped'] = (new Date()).toLocaleString() // @todo persistence
      console.log('>>> unexistent url')
      let body = await scraping.create(object)
      await notify('created scraping, modified on ' + object.modified + ', ' + object.url, object, context)
      return {
        statusCode: '201',
        body: JSON.stringify(body)
      }
    } else {
      const original = new Date(read[0].modified)
      const current = new Date(object.modified)
      if (current > original) {
        console.log('>>> modified url')
        // let text = 'diff?' // diff(read[0].data, object.data)
        let body = await scraping.update({
          ...(read[0]),
          ...{
            'modified': current,
            'scraped': (new Date()).toLocaleString()
            // 'diff': diff
          }
        })
        await notify('updated scraping, modified on ' + current + ' since ' + original + ', ' + object.url, object, context)
        return {
          statusCode: '200',
          body: JSON.stringify(body)
        }
      }
      console.log('>>> unmodified url')

      let body = await scraping.update({
        ...(read[0]),
        ...{ 'scraped': (new Date()).toLocaleString() }
      })

      return {
        statusCode: '204',
        body: JSON.stringify(body)
      }
    }
  } catch (err) {
    throw err
  }
}

function diff (html1, html2) {
  const HtmlDiffer = require('html-differ').HtmlDiffer
  // logger = require('html-differ/lib/logger')

  var options = {
    ignoreAttributes: [],
    compareAttributesAsJSON: [],
    ignoreWhitespaces: true,
    ignoreComments: true,
    ignoreEndTags: false,
    ignoreDuplicateAttributes: false
  }

  var htmlDiffer = new HtmlDiffer(options)

  return htmlDiffer.diffHtml(html1, html2)
}

function config (context) {
  if (context.invokedFunctionArn) {
    return {
      region: context.invokedFunctionArn.split(':')[3],
      accountId: context.invokedFunctionArn.split(':')[4]
    }
  }

  return {
    region: 'us-east-1',
    accountId: ''
  }
}

async function notify (message, body, context) {
  var sns = new AWS.SNS()
  var aws = config(context)
  var params = {
    Message: message + '\n\n--\n' + JSON.stringify(body),
    Subject: 'URLMonitor for ' + body.id + ' modified on ' + body.modified,
    TopicArn: 'arn:aws:sns:' + aws.region + ':' + aws.accountId + ':' + process.env.TOPIC
  }
  var result = sns.publish(params, context.done)
  console.log('>>> notified, result ' + result)
  return result
}

async function request (url, results, context) {
  try {
    const ret = await axios(url)
    console.log('query ' + url + ' result is ' + ret.status)
    scraping = {
      'url': url,
      'modified': ret.headers['last-modified'],
      'content-type': ret.headers['content-type']
    }
    // scraping['data'] = ret.data // @todo object size

    var response = await createOrUpdate(scraping, context)
    results.push(response)
  } catch (err) {
    console.error('query ' + url + ' error: ' + err)
    response = {
      'statusCode': 500,
      'message': err
    }
    results.push(response)
  }
}
