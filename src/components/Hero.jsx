import { motion } from 'framer-motion'

const container = {
  hidden: {},
  show: { transition: { staggerChildren: 0.12, delayChildren: 0.15 } },
}
const item = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.65, ease: [0.22, 1, 0.36, 1] } },
}

export default function Hero({ heading = 'AXIS SEATTLE' }) {
  return (
    <section className="relative w-full bg-transparent">
      <div className="container mx-auto px-4 pb-10 pt-12 sm:px-6 sm:pb-12 sm:pt-16 lg:px-8 lg:pb-14 lg:pt-20">
        <motion.div className="flex justify-center" variants={container} initial="hidden" animate="show">
          <motion.h1 variants={item} className="font-display mx-auto text-center text-[clamp(2rem,4.8vw,4rem)] font-semibold leading-[0.96] tracking-[-0.04em] text-slate-900 sm:whitespace-nowrap">
            {heading}
          </motion.h1>
        </motion.div>
      </div>
    </section>
  )
}
