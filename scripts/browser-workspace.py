"""Production Mermaid interactions; supplemental to the frozen callable contract."""
import argparse, base64, json, pathlib, zlib
from urllib.parse import urlparse
from playwright.sync_api import sync_playwright, expect
p=argparse.ArgumentParser();p.add_argument('--url',required=True);p.add_argument('--executable',required=True);p.add_argument('--output',required=True);p.add_argument('--side',required=True);p.add_argument('--inspect',action='store_true');a=p.parse_args()
out=pathlib.Path(a.output);out.mkdir(parents=True,exist_ok=True)
errors=[];steps=[];result={'side':a.side,'status':'running','errors':errors,'steps':steps,'network':'online-supplemental'}
def decode(url):
    payload=urlparse(url).fragment.split(':',1)[1];return json.loads(zlib.decompress(base64.urlsafe_b64decode(payload+'='*((-len(payload))%4))))
def watch(page):
    page.on('pageerror',lambda e:errors.append(str(e)));page.on('requestfailed',lambda r:errors.append('request failed '+r.url));page.on('response',lambda r:errors.append('HTTP '+str(r.status)+' '+r.url) if r.status>=400 else None)
with sync_playwright() as pw:
    browser=pw.chromium.launch(executable_path=a.executable,headless=True);context=browser.new_context(viewport={'width':1440,'height':1000},service_workers='block');context.tracing.start(screenshots=True,snapshots=True,sources=False);page=context.new_page();page.set_default_timeout(20000);watch(page)
    try:
        page.goto(a.url+'/edit',wait_until='networkidle')
        if a.inspect:
            print(page.locator('body').inner_text()[:6000]);print(page.locator('.monaco-editor').count())
        else:
            code='flowchart LR\nA[Customer] --> B[Invoice]'
            page.locator('.monaco-editor').first.click();page.keyboard.press('ControlOrMeta+A');page.keyboard.insert_text(code)
            for label in ['Customer','Invoice']:expect(page.locator('svg .nodeLabel').filter(has_text=label)).to_be_visible()
            steps.append('Edited diagram and observed both rendered SVG labels')
            page.get_by_role('button',name='Share',exact=True).click();link=page.locator('input[type="url"]').input_value();assert decode(link)['code']==code;steps.append('Share URL encodes edited diagram')
            page.screenshot(path=str(out/(a.side+'.png')))
            isolated=browser.new_context(service_workers='block');shared=isolated.new_page();watch(shared);shared.goto(link,wait_until='networkidle')
            for label in ['Customer','Invoice']:expect(shared.locator('svg .nodeLabel').filter(has_text=label)).to_be_visible()
            shared.reload(wait_until='networkidle')
            for label in ['Customer','Invoice']:expect(shared.locator('svg .nodeLabel').filter(has_text=label)).to_be_visible()
            shared.screenshot(path=str(out/(a.side+'-reloaded.png')));steps.append('Opened share URL in fresh context, reloaded and retained rendered diagram');isolated.close()
            # Valid JSON with a malformed state field: baseline accepts, candidate rejects before loading.
            bad={'code':'flowchart LR\nX[MalformedStateAccepted] --> Y[Unexpected]','mermaid':'{}','grid':'invalid'}
            encoded=base64.urlsafe_b64encode(json.dumps(bad).encode()).decode().rstrip('=');invalid=browser.new_context(service_workers='block');badpage=invalid.new_page();watch(badpage);badpage.goto(a.url+'/edit#base64:'+encoded,wait_until='networkidle')
            if a.side=='candidate':
                expect(badpage.locator('svg .nodeLabel').filter(has_text='Loading URL failed')).to_be_visible();expect(badpage.locator('svg .nodeLabel').filter(has_text='MalformedStateAccepted')).to_have_count(0)
                steps.append('Malformed shared-state field triggers existing URL failure UI')
            else:
                expect(badpage.locator('svg .nodeLabel').filter(has_text='MalformedStateAccepted')).to_be_visible();steps.append('Baseline visibly accepts the malformed shared state')
            badpage.screenshot(path=str(out/(a.side+'-invalid.png')));invalid.close()
            assert not errors,errors
        result['status']='passed'
    except Exception as e:
        result['status']='failed';result['error']=str(e);page.screenshot(path=str(out/(a.side+'-failure.png')))
    finally:
        context.tracing.stop(path=str(out/(a.side+'.zip')));browser.close();(out/(a.side+'.json')).write_text(json.dumps(result,indent=2));print(json.dumps(result))
if result['status']!='passed':raise SystemExit(1)
