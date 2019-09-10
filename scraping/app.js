// import { Persistence, Persistent } from './persistence'

const dynamoose = require('dynamoose')
const uuidv1 = require('uuid/v1')
const AWS = require('aws-sdk')
const URL = require('url').URL
const { crc32 } = require('crc')
const fileType = require('file-type')
const mime = require('mime')
const sha1 = require('sha1')

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
      'crc': String,
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
      object['crc'] = crc32(object['data']).toString(16)
      object['data'] = await upload(object, { mime: object['content-type'] })
      console.log('>>> unexistent url')
      let body = await scraping.create(object)
      await notify('created scraping, modified on ' + object.modified + ' with crc ' + object.crc + ', ' + object.url, object, context)
      return {
        statusCode: '201',
        body: JSON.stringify(body)
      }
    } else {
      const original = new Date(read[0].modified)
      const current = new Date(object.modified)
      const crc = crc32(object.data).toString(16)

      if (current > original || read[0].crc !== crc) {
        var message = ''
        if (current > original) {
          console.log('>>> modified url')
          message = message + 'modified on ' + current + ' since ' + original + ', '
        }
        if (read[0].crc !== crc) {
          console.log('>>> crc changed for url data')
          message = message + 'with crc ' + crc + ' distinct of ' + read[0].crc + ', '
        }
        // let text = 'diff?' // diff(read[0].data, object.data)
        var url = await upload(read[0], { mime: object['content-type'] }, object.data)
        let body = await scraping.update({
          ...(read[0]),
          ...{
            'modified': current,
            'scraped': (new Date()).toLocaleString(),
            'crc': crc,
            'data': url,
            'content-type': object['content-type']
            // 'diff': diff
          }
        })
        await notify('updated scraping, ' + message + object.url, object, context)
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

const upload = async (object, options, data) => {
  const s3 = new AWS.S3()

  let buffer = Buffer.from(data || object.data, 'utf-8')
  let type = (options && options.mime)
    ? { ext: mime.getExtension(options.mime), mime: options.mime }
    : fileType(buffer)

  // @todo Default extension is 'html'... || { ext: 'html', mime: 'text/html; charset=utf8' }

  if (!type) {
    throw new Error('Could not identify a file type')
  }

  let file = getFile(object.id, type, buffer)
  let params = file.params
  let put = await s3.putObject(params)
  console.log('>>> s3 object was put ' + put)

  return file.path // 'about:' + object.id
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

  const url = new URL(body.url)
  var params = {
    Message: message, // + '\n\n--\n' + JSON.stringify(body)
    Subject: 'URLMonitor for ' + url.hostname + ' modified on ' + body.modified,
    TopicArn: 'arn:aws:sns:' + aws.region + ':' + aws.accountId + ':' + process.env.TOPIC
  }
  var result = sns.publish(params, context.done)
  console.log('>>> notified, result ' + result)
  return result
}

async function request (url, results, context) {
  try {
    const ret = await axios(url) // { baseURL: url, responseType: 'arraybuffer' } ?
    console.log('query ' + url + ' result is ' + ret.status)
    var scraping = {
      'url': url,
      'modified': ret.headers['last-modified'],
      'content-type': ret.headers['content-type'],
      'data': ret.data
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

let getFile = function (id, mime, buffer) {
  let bucket = process.env.BUCKET || 'urlmonitor-dev-722849825715' // @todo parametrize

  let hash = sha1(Buffer.from(new Date().toString()))
  // let now = moment().format('YYY-MM-DD HH:mm:ss')

  // @todo Versioned bucket || friendly key like hostname || ...
  let path = (process.env.BUCKET_KEY ? (process.env.BUCKET_KEY + '/') : '') + hash + '/'
  let name = id + '.' + mime.ext
  let fullName = path + name
  let fullPath = bucket + '/' + fullName

  let params = {
    Bucket: bucket,
    Key: fullName,
    Body: buffer
  }

  let file = {
    size: buffer.toString('ascii').length,
    type: mime.mime,
    name: name,
    path: fullPath
  }

  return {
    'params': params,
    'file': file
  }
}
